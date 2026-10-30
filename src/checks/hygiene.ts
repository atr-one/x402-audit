/** Protocol hygiene: CORS on the 402, response time, and what an x402 v1 client is told. */
import { decodePaymentRequired } from '../payment-required.js';
import type { HttpContext, HttpResult } from '../http.js';
import type { Finding, PaidEndpoint } from '../types.js';
import { sendUnpaid } from './response.js';

export const SLOW_MS = 2000;
export const VERY_SLOW_MS = 5000;

export function checkCors(headers: Headers, endpoint?: string): Finding[] {
  const findings: Finding[] = [];
  const add = (f: Finding) => findings.push(endpoint ? { ...f, endpoint } : f);
  const allowOrigin = headers.get('access-control-allow-origin');
  const expose = (headers.get('access-control-expose-headers') ?? '').split(',').map((s) => s.trim().toLowerCase());
  if (!allowOrigin) {
    add({ id: 'hygiene.cors-origin', severity: 'info', message: 'The 402 has no Access-Control-Allow-Origin; browser-based x402 clients on other origins cannot read it.', fix: 'Send Access-Control-Allow-Origin (e.g. *) on paid endpoints if browser clients should pay.' });
    return findings;
  }
  if (expose.includes('*')) return findings;
  const missing = ['payment-required', 'payment-response'].filter((h) => !expose.includes(h));
  if (missing.length)
    add({ id: 'hygiene.cors-expose', severity: 'warn', message: `Access-Control-Expose-Headers lacks ${missing.map((m) => m.toUpperCase()).join(' and ')}; browsers hide these headers from client code.`, fix: 'Access-Control-Expose-Headers: PAYMENT-REQUIRED, PAYMENT-RESPONSE' });
  return findings;
}

export function checkLatency(ms: number | undefined, endpoint?: string): Finding[] {
  if (ms === undefined || ms < SLOW_MS) return [];
  const f: Finding = ms >= VERY_SLOW_MS
    ? { id: 'hygiene.latency', severity: 'warn', message: `The 402 took ${ms} ms; a price quote should be fast, and payers wait for it before every call.`, fix: 'Answer unpaid requests before doing any work (no database query beyond the price).' }
    : { id: 'hygiene.latency', severity: 'info', message: `The 402 took ${ms} ms.` };
  return [endpoint ? { ...f, endpoint } : f];
}

/** A v1 `X-PAYMENT` value that cannot pay anything: base64 of an unsigned, empty v1 payload. */
export const BOGUS_V1_PAYMENT = Buffer.from(JSON.stringify({ x402Version: 1, scheme: 'exact', network: 'base', payload: {} })).toString('base64');

/**
 * Repeat the unpaid request with an x402 v1 `X-PAYMENT` header carrying an unsigned, empty payload. It cannot pay
 * anything; it shows what a v1 client is told.
 */
export async function probeV1(ctx: HttpContext, ep: PaidEndpoint): Promise<Finding[]> {
  const res = await sendUnpaid(ctx, ep, { 'X-PAYMENT': BOGUS_V1_PAYMENT });
  return [{ ...classifyV1(res), endpoint: ep.url }];
}

export function classifyV1(res: HttpResult): Finding {
  if (res.error) return { id: 'hygiene.v1', severity: 'info', message: `A request with a v1 X-PAYMENT header failed: ${res.error}.` };
  const status = res.status as number;
  if (status >= 200 && status < 300)
    return { id: 'hygiene.v1', severity: 'error', message: `A request with an unsigned, empty v1 X-PAYMENT answered ${status}: the payment is not verified.`, fix: 'Verify every payment with the facilitator before serving the resource.' };
  if (status >= 500)
    return { id: 'hygiene.v1', severity: 'warn', message: `A request with a v1 X-PAYMENT header answered ${status}.`, fix: 'Answer v1 payments with 402 (or 400) and a message that v2 (PAYMENT-SIGNATURE) is required.' };
  let text = res.text.slice(0, 20000);
  const header = res.headers.get('payment-required');
  if (header) {
    const d = decodePaymentRequired(header);
    if (d.ok) text += ' ' + d.json;
  }
  const helpful = /version|v2|payment-signature|x402Version/i.test(text);
  if (helpful) return { id: 'hygiene.v1', severity: 'info', message: `A v1 client (X-PAYMENT) gets ${status} with an explanation.` };
  return { id: 'hygiene.v1', severity: 'info', message: `A v1 client (X-PAYMENT) gets ${status} without saying that v2 is required.`, fix: 'Tell v1 clients that x402 v2 and the PAYMENT-SIGNATURE header are required.' };
}
