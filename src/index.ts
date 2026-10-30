import { checkBazaar } from './checks/bazaar.js';
import { checkFacilitatorListing, DEFAULT_FACILITATOR } from './checks/facilitator.js';
import { checkCors, checkLatency, probeV1 } from './checks/hygiene.js';
import { checkPrice } from './checks/price.js';
import { probe402 } from './checks/response.js';
import { discover, normaliseOrigin } from './discovery.js';
import { DEFAULT_USER_AGENT, mapPool, VERSION, type HttpContext } from './http.js';
import type { AuditOptions, AuditReport, EndpointResult, FacilitatorResult, Finding } from './types.js';

export * from './types.js';
export { decodePaymentRequired, validatePaymentRequired, type DecodeResult, type ValidationResult } from './payment-required.js';
export { parseCaip2, networkFamily, networkInfo, knownToken, NETWORKS, V1_NAMES, type NetworkInfo, type TokenInfo, type Caip2 } from './networks.js';
export { toChecksumAddress, checksumState, isEvmAddress, isSolanaAddress, base58Decode, type ChecksumState } from './address.js';
export { formatUnits, parseUnits, usdPrice, parseDocumentedPrice, priceMatches } from './price.js';
export { parseOpenApi, parseWellKnown, parsePaymentInfo, exampleFromSchema, normaliseOrigin } from './discovery.js';
export { formatConsole, formatMarkdown, exitCode } from './report.js';
export { VERSION, DEFAULT_USER_AGENT } from './http.js';

/**
 * Audit an x402 seller without paying: read its discovery documents, request each paid endpoint unpaid, and check the
 * 402 it answers. Never sends a payment.
 */
export async function audit(origin: string, options: AuditOptions = {}): Promise<AuditReport> {
  const started = Date.now();
  const base = normaliseOrigin(origin);
  const ctx: HttpContext = {
    fetch: options.fetch ?? globalThis.fetch,
    timeoutMs: options.timeoutMs ?? 20_000,
    userAgent: options.userAgent ?? DEFAULT_USER_AGENT
  };
  const maxUsd = options.maxPriceUsd ?? 10;

  const discovery = await discover(ctx, base, options.endpoints ?? [], options.maxEndpoints ?? 50);

  const endpoints: EndpointResult[] = await mapPool(discovery.endpoints, options.concurrency ?? 3, async (ep) => {
    const { result, response } = await probe402(ctx, ep);
    if (result.status !== undefined) result.findings.push(...checkCors(response.headers, ep.url), ...checkLatency(result.timeMs, ep.url));
    const pr = result.paymentRequired;
    if (pr) {
      result.findings.push(...checkPrice(pr, ep.price, maxUsd, ep.url));
      result.findings.push(...checkBazaar(pr, ep.method, result.headerBytes, ep.url));
    }
    return result;
  });

  // v1 behaviour: one probe, on the first endpoint that answered 402
  const extra: Finding[] = [];
  if (options.probeV1 !== false) {
    const first = discovery.endpoints.find((ep, i) => endpoints[i]?.status === 402);
    if (first) extra.push(...(await probeV1(ctx, first)));
  }

  // facilitator listing, once per payTo
  let facilitator: FacilitatorResult[] | undefined;
  if (options.facilitatorDiscovery) {
    const payTos = new Set<string>();
    for (const r of endpoints) for (const a of r.paymentRequired?.accepts ?? []) if (typeof a?.payTo === 'string' && a.payTo) payTos.add(a.payTo);
    const audited = endpoints.map((e) => e.url);
    facilitator = [];
    for (const payTo of [...payTos].slice(0, 5)) {
      const fr = await checkFacilitatorListing(ctx, options.facilitatorUrl ?? DEFAULT_FACILITATOR, payTo, audited);
      facilitator.push(fr);
      extra.push(...fr.findings);
    }
  }

  const findings = [...discovery.findings, ...endpoints.flatMap((e) => e.findings), ...extra];
  const summary = { error: 0, warn: 0, info: 0 };
  for (const f of findings) summary[f.severity]++;
  const report: AuditReport = {
    tool: { name: 'x402-audit', version: VERSION },
    origin: base,
    startedAt: new Date(started).toISOString(),
    durationMs: Date.now() - started,
    discovery,
    endpoints,
    findings,
    summary
  };
  if (facilitator) report.facilitator = facilitator;
  return report;
}
