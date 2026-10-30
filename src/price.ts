import { knownToken } from './networks.js';
import type { DocumentedPrice, PaymentRequirements } from './types.js';

/**
 * Atomic units -> decimal string, exactly (no floating point): formatUnits("10000", 6) === "0.01".
 * Throws on a non-integer string.
 */
export function formatUnits(amount: string, decimals: number): string {
  if (!/^\d+$/.test(amount)) throw new Error(`not an integer amount: ${amount}`);
  if (!Number.isInteger(decimals) || decimals < 0) throw new Error(`bad decimals: ${decimals}`);
  const digits = amount.replace(/^0+(?=\d)/, '');
  if (decimals === 0) return digits;
  const padded = digits.padStart(decimals + 1, '0');
  const whole = padded.slice(0, -decimals);
  const frac = padded.slice(-decimals).replace(/0+$/, '');
  return frac ? `${whole}.${frac}` : whole;
}

/** Decimal string -> atomic units string, exactly: parseUnits("0.01", 6) === "10000". Null when it has too many decimals. */
export function parseUnits(value: string, decimals: number): string | null {
  const m = /^(\d*)(?:\.(\d*))?$/.exec(value.trim());
  if (!m || (m[1] === '' && (m[2] ?? '') === '')) return null;
  const frac = m[2] ?? '';
  if (frac.length > decimals) return null;
  const s = ((m[1] ?? '') + frac.padEnd(decimals, '0')).replace(/^0+(?=\d)/, '');
  return s === '' ? '0' : s;
}

/** The USD price of one accepts[] entry when its asset is a known USD stablecoin; undefined otherwise. */
export function usdPrice(accept: Pick<PaymentRequirements, 'network' | 'asset' | 'amount'>): number | undefined {
  if (typeof accept.amount !== 'string' || !/^\d+$/.test(accept.amount)) return undefined;
  const token = typeof accept.network === 'string' && typeof accept.asset === 'string' ? knownToken(accept.network, accept.asset) : undefined;
  if (!token) return undefined;
  return Number(formatUnits(accept.amount, token.decimals));
}

/** Parse a USD amount written as a number or a string ("0.01", "$0.01", "0.01 USD"). */
export function parseUsd(value: unknown): number | undefined {
  if (typeof value === 'number') return Number.isFinite(value) && value >= 0 ? value : undefined;
  if (typeof value !== 'string') return undefined;
  const m = /^\s*\$?\s*(\d+(?:\.\d+)?|\.\d+)\s*(?:usd|usdc)?\s*$/i.exec(value);
  return m ? Number(m[1]) : undefined;
}

/**
 * Parse the `price` of an OpenAPI `x-payment-info`. Accepted shapes:
 * - `{"mode": "fixed", "currency": "USD", "amount": "0.01"}`
 * - `{"mode": "dynamic", "currency": "USD", "min": "0.01", "max": "0.50"}`
 * - `"0.01"`, `"$0.01"`, `0.01`, `{"amount": "0.01"}` (no mode: fixed)
 */
export function parseDocumentedPrice(price: unknown): DocumentedPrice | undefined {
  const direct = parseUsd(price);
  if (direct !== undefined) return { mode: 'fixed', amount: direct };
  if (typeof price !== 'object' || price === null || Array.isArray(price)) return undefined;
  const p = price as Record<string, unknown>;
  const currency = p['currency'];
  if (currency !== undefined && (typeof currency !== 'string' || !/^usdc?$/i.test(currency))) return undefined;
  if (p['mode'] === 'dynamic' || ('min' in p && 'max' in p && !('amount' in p))) {
    const min = parseUsd(p['min']);
    const max = parseUsd(p['max']);
    if (min === undefined || max === undefined || min > max) return undefined;
    return { mode: 'dynamic', min, max };
  }
  const amount = parseUsd(p['amount']);
  return amount === undefined ? undefined : { mode: 'fixed', amount };
}

/** Whether a USD price matches a documented price (fixed: equal to the cent fraction; dynamic: within range). */
export function priceMatches(usd: number, documented: DocumentedPrice): boolean {
  const eps = 1e-9;
  if (documented.mode === 'fixed') return Math.abs(usd - documented.amount) < eps;
  return usd >= documented.min - eps && usd <= documented.max + eps;
}

export function describePrice(documented: DocumentedPrice): string {
  return documented.mode === 'fixed' ? `$${documented.amount}` : `$${documented.min}-$${documented.max}`;
}
