import { networkLabel, parseCaip2 } from '../networks.js';
import { describePrice, priceMatches, usdPrice } from '../price.js';
import type { DocumentedPrice, Finding, PaymentRequired } from '../types.js';

export const MIN_SANE_USD = 0.001;

/**
 * Price consistency: the USD price of each offer (amount / 10^decimals of a known USDC deployment) against the
 * OpenAPI `x-payment-info` price and against sane bounds.
 */
export function checkPrice(pr: PaymentRequired, documented: DocumentedPrice | undefined, maxUsd: number, endpoint?: string): Finding[] {
  const findings: Finding[] = [];
  const add = (f: Finding) => findings.push(endpoint ? { ...f, endpoint } : f);
  const priced: { network: string; usd: number }[] = [];
  let unknown = 0;
  for (const a of Array.isArray(pr.accepts) ? pr.accepts : []) {
    const usd = usdPrice(a);
    if (usd === undefined) {
      // (an invalid amount or network is reported by the PaymentRequired validation)
      if (typeof a?.amount === 'string' && /^\d+$/.test(a.amount) && parseCaip2(a.network)) unknown++;
      continue;
    }
    priced.push({ network: String(a.network), usd });
    if (usd > 0 && usd < MIN_SANE_USD)
      add({ id: 'price.too-low', severity: 'warn', message: `${networkLabel(a.network)}: $${usd} per call is below $${MIN_SANE_USD}; settlement costs can exceed it and some facilitators refuse such amounts.`, fix: 'Check the decimals: USDC has 6, so $0.01 is "10000".' });
    if (usd > maxUsd)
      add({ id: 'price.too-high', severity: 'warn', message: `${networkLabel(a.network)}: $${usd} per call is above the $${maxUsd} ceiling.`, fix: 'Check the decimals (USDC has 6), or raise the ceiling with --max-price.' });
  }
  if (unknown) add({ id: 'price.unknown-asset', severity: 'info', message: `${unknown} offer(s) use an asset outside the built-in USDC table; their price was not checked.` });
  if (!documented || priced.length === 0) return findings;

  const cheapest = priced.reduce((m, p) => (p.usd < m.usd ? p : m));
  if (!priceMatches(cheapest.usd, documented))
    add({ id: 'price.mismatch', severity: 'warn', message: `The cheapest offer is $${cheapest.usd} (${networkLabel(cheapest.network)}) but /openapi.json documents ${describePrice(documented)}.`, fix: 'Make x-payment-info.price and the 402 amounts come from the same source.' });
  const differ = priced.filter((p) => p !== cheapest && !priceMatches(p.usd, documented));
  if (differ.length)
    add({ id: 'price.network-differs', severity: 'info', message: `Offers outside the documented ${describePrice(documented)}: ${differ.map((p) => `${networkLabel(p.network)} $${p.usd}`).join(', ')} (e.g. a per-network minimum).` });
  return findings;
}
