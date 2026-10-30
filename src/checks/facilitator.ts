/**
 * Facilitator listing (opt-in): ask a facilitator's discovery list which resources it knows for a payTo address.
 * PayAI: GET https://facilitator.payai.network/discovery/resources?payTo=<address>. The lookup is case-sensitive, so an
 * EVM address is sent in EIP-55 checksum form (a lowercase address finds nothing).
 */
import { isEvmAddress, toChecksumAddress } from '../address.js';
import { parseJson, request, type HttpContext } from '../http.js';
import type { FacilitatorResult, Finding } from '../types.js';

export const DEFAULT_FACILITATOR = 'https://facilitator.payai.network';

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const pathKey = (u: string) => {
  try {
    const url = new URL(u);
    return url.origin + url.pathname.replace(/\/+$/, '');
  } catch {
    return u;
  }
};

/** Pull resource URLs out of a discovery answer (`items[].resource` or `resources[]`). */
export function listedResources(doc: unknown): { urls: string[]; total?: number } {
  if (!isObject(doc)) return { urls: [] };
  const list = Array.isArray(doc['items']) ? doc['items'] : Array.isArray(doc['resources']) ? doc['resources'] : [];
  const urls: string[] = [];
  for (const it of list) {
    const r = typeof it === 'string' ? it : isObject(it) ? (it['resource'] ?? it['url']) : undefined;
    const u = typeof r === 'string' ? r : isObject(r) && typeof r['url'] === 'string' ? r['url'] : undefined;
    if (u) urls.push(u);
  }
  const pg = isObject(doc['pagination']) ? doc['pagination'] : {};
  const total = typeof pg['total'] === 'number' ? pg['total'] : undefined;
  return total === undefined ? { urls } : { urls, total };
}

export async function checkFacilitatorListing(ctx: HttpContext, base: string, payTo: string, audited: string[]): Promise<FacilitatorResult> {
  const findings: Finding[] = [];
  const query = isEvmAddress(payTo) ? toChecksumAddress(payTo) : payTo;
  const url = `${base.replace(/\/+$/, '')}/discovery/resources?payTo=${encodeURIComponent(query)}&limit=100`;
  const out: FacilitatorResult = { url, payTo: query, listed: [], findings };
  if (query !== payTo) findings.push({ id: 'facilitator.case', severity: 'info', message: `payTo ${payTo} was looked up as ${query}; the facilitator's discovery list is case-sensitive.` });
  const res = await request(ctx, url);
  if (res.error || res.status !== 200) {
    findings.push({ id: 'facilitator.error', severity: 'info', message: `${base} discovery answered ${res.error ?? `HTTP ${res.status}`}; listing not checked.` });
    return out;
  }
  const parsed = parseJson(res.text);
  if (!parsed.ok) {
    findings.push({ id: 'facilitator.error', severity: 'info', message: `${base} discovery did not answer JSON; listing not checked.` });
    return out;
  }
  const { urls, total } = listedResources(parsed.value);
  if (total !== undefined) out.total = total;
  const want = new Set(audited.map(pathKey));
  out.listed = [...new Set(urls.filter((u) => want.has(pathKey(u))))];
  const host = new URL(base).host;
  if (urls.length === 0)
    findings.push({ id: 'facilitator.not-listed', severity: 'warn', message: `${host} lists no resource for payTo ${query}.`, fix: 'Facilitators usually catalog a resource after settling a payment for it that carries the bazaar extension; settle one test payment through this facilitator.' });
  else
    findings.push({ id: 'facilitator.listed', severity: 'info', message: `${host} lists ${total ?? urls.length} resource(s) for payTo ${query}; ${out.listed.length} of the ${audited.length} audited endpoint(s) are among them.` });
  return out;
}
