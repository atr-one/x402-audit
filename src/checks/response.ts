/**
 * The 402 probe: one unpaid request per endpoint, then the PAYMENT-REQUIRED header decoded and validated, and the
 * response body compared with it.
 */
import { looksLikeBotWall, parseJson, request, type HttpContext, type HttpResult } from '../http.js';
import { networkLabel, onNetworks } from '../networks.js';
import { decodePaymentRequired, validatePaymentRequired } from '../payment-required.js';
import type { EndpointResult, Finding, PaidEndpoint, PaymentRequired, PaymentRequirements } from '../types.js';

export const HEADER_WARN_BYTES = 8 * 1024;
export const HEADER_ERROR_BYTES = 16 * 1024;

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

export interface Probe {
  result: EndpointResult;
  response: HttpResult;
}

/** Send the unpaid request the endpoint documents (GET, or POST with a minimal JSON body). */
export async function sendUnpaid(ctx: HttpContext, ep: PaidEndpoint, extraHeaders: Record<string, string> = {}): Promise<HttpResult> {
  const hasBody = ep.method !== 'GET' && ep.method !== 'DELETE';
  const headers: Record<string, string> = { ...extraHeaders };
  if (hasBody) headers['Content-Type'] = 'application/json';
  return request(ctx, ep.url, hasBody ? { method: ep.method, headers, body: JSON.stringify(ep.body ?? {}) } : { method: ep.method, headers });
}

/**
 * Probe one endpoint and check status, header and body. With `networks` (CAIP-2 ids), only the offers on those
 * networks are checked, and an endpoint with none of them gets `network.not-offered`.
 */
export async function probe402(ctx: HttpContext, ep: PaidEndpoint, networks?: ReadonlySet<string>): Promise<Probe> {
  const res = await sendUnpaid(ctx, ep);
  const findings: Finding[] = [];
  const result: EndpointResult = { url: ep.url, method: ep.method, sources: ep.sources, timeMs: res.timeMs, findings };
  const add = (f: Finding) => findings.push({ ...f, endpoint: ep.url });

  if (res.error) {
    if (/HEADERS_OVERFLOW|header.*(too large|overflow)/i.test(res.error))
      add({ id: 'header.size', severity: 'error', message: `The response headers exceed Node's 16 KB limit (${res.error}); Node-based x402 clients cannot read this 402.`, fix: 'Shrink PAYMENT-REQUIRED: drop descriptions and long examples from the bazaar extension.' });
    else add({ id: 'http.unreachable', severity: 'error', message: `${ep.method} ${ep.url} failed: ${res.error}.` });
    return { result, response: res };
  }
  result.status = res.status as number;
  const wall = looksLikeBotWall(res);
  if (wall) {
    add({ id: 'http.blocked', severity: 'error', message: `${ep.method} answered ${res.status} from ${wall}, not the application; agents calling without a browser get the same.`, fix: 'Exempt paid endpoints and discovery documents from bot challenges (e.g. a WAF skip rule for these paths).' });
    return { result, response: res };
  }

  const header = res.headers.get('payment-required');
  if (res.status !== 402) {
    if (res.status === 200 || res.status === 201 || res.status === 204)
      add({ id: 'http.status', severity: 'error', message: `${ep.method} without payment answered ${res.status}: the endpoint is free or does not enforce payment.`, fix: 'Answer an unpaid request with 402 and PAYMENT-REQUIRED, or remove it from the paid listings.' });
    else
      add({ id: 'http.status', severity: 'error', message: `${ep.method} without payment answered ${res.status}, expected 402.`, fix: res.status === 401 || res.status === 403 ? 'x402 clients only pay on a 402; answer keyless calls with 402 rather than an authentication error.' : 'Check the URL and method; an unpaid call of a paid endpoint should answer 402.' });
    if (!header) return { result, response: res };
  }

  // the PaymentRequired: header first, body as a fallback (v1 servers put it in the body)
  const body = parseJson(res.text);
  const bodyPr = body.ok ? paymentRequiredInBody(body.value) : undefined;
  let pr: unknown;
  if (!header) {
    if (bodyPr && isObject(bodyPr) && bodyPr['x402Version'] === 1)
      add({ id: 'http.payment-required-header', severity: 'error', message: 'No PAYMENT-REQUIRED header; the body carries an x402 v1 PaymentRequired. v2 clients read the header.', fix: 'Upgrade to x402 v2: send base64(JSON PaymentRequired) in the PAYMENT-REQUIRED header.' });
    else if (bodyPr)
      add({ id: 'http.payment-required-header', severity: 'error', message: 'No PAYMENT-REQUIRED header; a PaymentRequired is only in the body. v2 clients read the header.', fix: 'Send base64(JSON PaymentRequired) in the PAYMENT-REQUIRED header.' });
    else add({ id: 'http.payment-required-header', severity: 'error', message: 'No PAYMENT-REQUIRED header on the 402.', fix: 'Send base64(JSON PaymentRequired) in the PAYMENT-REQUIRED header.' });
    if (!bodyPr) return { result, response: res };
    pr = bodyPr; // validate what there is, so the remaining findings are still useful
  } else {
    result.headerBytes = Buffer.byteLength(header, 'utf8');
    const decoded = decodePaymentRequired(header);
    if (!decoded.ok) {
      add({ id: 'pr.decode', severity: 'error', message: `PAYMENT-REQUIRED cannot be decoded: ${decoded.error}.`, fix: 'Send base64(JSON.stringify(paymentRequired)) with the standard base64 alphabet.' });
      if (decoded.plainJson === undefined) return { result, response: res };
      pr = decoded.plainJson;
    } else {
      if (decoded.encoding === 'base64url') add({ id: 'pr.decode', severity: 'warn', message: 'PAYMENT-REQUIRED uses the base64url alphabet; the spec and most clients expect standard base64.', fix: 'Use standard base64 (+ and /).' });
      pr = decoded.value;
    }
    if (result.headerBytes > HEADER_ERROR_BYTES)
      add({ id: 'header.size', severity: 'error', message: `PAYMENT-REQUIRED is ${kb(result.headerBytes)}; over 16 KB it breaks Node clients (16 KB total header limit) and many proxies.`, fix: 'Shrink the bazaar extension: drop descriptions, shorten examples.' });
    else if (result.headerBytes > HEADER_WARN_BYTES)
      add({ id: 'header.size', severity: 'warn', message: `PAYMENT-REQUIRED is ${kb(result.headerBytes)}; payers echo the accepted requirements back in PAYMENT-SIGNATURE and many proxies cap a header line at 8-16 KB.`, fix: 'Keep the header under 8 KB: drop descriptions and long examples from the bazaar extension.' });
  }

  const v = validatePaymentRequired(pr, networks ? { networks } : {});
  for (const f of v.findings) add(f);
  if (isObject(pr) && Array.isArray(pr['accepts'])) result.paymentRequired = pr as unknown as PaymentRequired;
  if (networks && result.paymentRequired && result.paymentRequired.accepts.length > 0) {
    const offered = result.paymentRequired.accepts.map((a) => (isObject(a) ? a['network'] : undefined));
    if (!offered.some((n) => onNetworks(n, networks))) {
      const names = [...new Set(offered.map((n) => (typeof n === 'string' ? networkLabel(n) : String(n))))].join(', ');
      add({ id: 'network.not-offered', severity: 'error', message: `None of the ${offered.length} offer(s) is on the selected network(s) ${[...networks].map(networkLabel).join(', ')}; offered: ${names}.`, fix: 'Add an offer on that network if its clients should be able to pay, or audit another network.' });
    }
  }

  // resource.url should point at the endpoint itself
  const rUrl = isObject(pr) && isObject(pr['resource']) ? pr['resource']['url'] : undefined;
  if (typeof rUrl === 'string' && /^https?:/i.test(rUrl)) {
    try {
      const a = new URL(rUrl);
      const b = new URL(ep.url);
      if (a.origin !== b.origin || a.pathname.replace(/\/+$/, '') !== b.pathname.replace(/\/+$/, ''))
        add({ id: 'pr.resource.url-mismatch', severity: 'info', message: `resource.url ${rUrl} differs from the requested URL; catalogs key resources by this URL.` });
    } catch {
      /* reported by validation */
    }
  }

  // body consistency
  if (header && bodyPr && result.paymentRequired) {
    const diff = compareRequirements(onlyNetworks(result.paymentRequired, networks), onlyNetworks(bodyPr, networks));
    if (diff) add({ id: 'pr.body-mismatch', severity: 'warn', message: `The body's PaymentRequired differs from the header: ${diff}.`, fix: 'Build both from the same object, or drop it from the body.' });
  }
  if (res.status === 402 && !body.ok && res.text.trim() !== '')
    add({ id: 'http.body', severity: 'info', message: 'The 402 body is not JSON; agents read the header, but a JSON body with an explanation helps humans and LLM-driven clients.' });
  return { result, response: res };
}

/** Find a PaymentRequired-like object in a 402 body: the body itself, or under `x402` / `paymentRequired`. */
export function paymentRequiredInBody(body: unknown): unknown {
  if (!isObject(body)) return undefined;
  if ('x402Version' in body && 'accepts' in body) return body;
  for (const key of ['x402', 'paymentRequired', 'payment_required']) {
    const v = body[key];
    if (isObject(v) && 'accepts' in v) return v;
  }
  return undefined;
}

/** The object with `accepts` narrowed to the selected networks (unchanged without a selection or without accepts). */
function onlyNetworks<T>(pr: T, networks: ReadonlySet<string> | undefined): T {
  if (!networks || !isObject(pr) || !Array.isArray(pr['accepts'])) return pr;
  return { ...pr, accepts: pr['accepts'].filter((a: unknown) => onNetworks(isObject(a) ? a['network'] : undefined, networks)) };
}

const keyOf = (a: unknown) => {
  if (!isObject(a)) return JSON.stringify(a);
  const r = a as Partial<PaymentRequirements>;
  const evm = typeof r.network === 'string' && r.network.startsWith('eip155:');
  const norm = (s: unknown) => (typeof s === 'string' && evm ? s.toLowerCase() : String(s));
  return [r.scheme, r.network, r.amount ?? (a as Record<string, unknown>)['maxAmountRequired'], norm(r.asset), norm(r.payTo)].join('|');
};

/** A short description of how two PaymentRequired objects differ in what they ask to be paid, or '' when they agree. */
export function compareRequirements(header: PaymentRequired, body: unknown): string {
  if (!isObject(body)) return 'the body object is not an object';
  if (body['x402Version'] !== undefined && body['x402Version'] !== header.x402Version) return `x402Version ${String(body['x402Version'])} vs ${header.x402Version}`;
  const accepts = Array.isArray(body['accepts']) ? body['accepts'] : [];
  const h = new Set(header.accepts.map(keyOf));
  const b = new Set(accepts.map(keyOf));
  const onlyH = [...h].filter((k) => !b.has(k)).length;
  const onlyB = [...b].filter((k) => !h.has(k)).length;
  if (onlyH || onlyB) return `${onlyH} offer(s) only in the header, ${onlyB} only in the body`;
  return '';
}

const kb = (n: number) => `${(n / 1024).toFixed(1)} KB`;
