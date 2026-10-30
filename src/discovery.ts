/**
 * Discovery: `/.well-known/x402` (a list of paid resource URLs) and `/openapi.json` (operations carrying
 * `x-payment-info`), the two documents x402 directories and agent tooling read before probing a seller.
 */
import { looksLikeBotWall, parseJson, request, type HttpContext } from './http.js';
import { parseDocumentedPrice } from './price.js';
import type { DiscoveryResult, DocumentedPrice, Finding, HttpMethod, PaidEndpoint, Severity } from './types.js';

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const METHODS: HttpMethod[] = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'];

/** Normalise an origin: scheme + host (+ port), no path, no trailing slash. Throws on a non-http(s) URL. */
export function normaliseOrigin(input: string): string {
  const withScheme = /^https?:\/\//i.test(input) ? input : `https://${input}`;
  const u = new URL(withScheme);
  if (u.protocol !== 'http:' && u.protocol !== 'https:') throw new Error(`not an http(s) URL: ${input}`);
  return u.origin;
}

// ---------------------------------------------------------------------------------------------------------------
// /.well-known/x402

export interface WellKnownParse {
  resources: string[];
  findings: Finding[];
}

/** Parse a `/.well-known/x402` document: `{"version": 1, "resources": ["https://...", ...]}`. */
export function parseWellKnown(doc: unknown, origin: string): WellKnownParse {
  const findings: Finding[] = [];
  const resources: string[] = [];
  if (!isObject(doc)) {
    findings.push({ id: 'discovery.well-known.invalid', severity: 'error', message: '/.well-known/x402 is not a JSON object.', fix: 'Serve {"version": 1, "resources": ["https://.../paid-endpoint", ...]}.' });
    return { resources, findings };
  }
  const list = doc['resources'];
  if (!Array.isArray(list)) {
    findings.push({ id: 'discovery.well-known.invalid', severity: 'error', message: '/.well-known/x402 has no "resources" array.', fix: 'List the absolute URLs of the paid endpoints in "resources".' });
    return { resources, findings };
  }
  if (list.length === 0) findings.push({ id: 'discovery.well-known.empty', severity: 'warn', message: '/.well-known/x402 lists no resources.' });
  const bad: string[] = [];
  let foreign = 0;
  for (const entry of list) {
    const raw = typeof entry === 'string' ? entry : isObject(entry) ? (entry['url'] ?? entry['resource']) : undefined;
    if (typeof raw !== 'string') {
      bad.push(JSON.stringify(entry).slice(0, 60));
      continue;
    }
    let url: URL;
    try {
      url = new URL(raw);
    } catch {
      bad.push(raw);
      continue;
    }
    if (url.protocol !== 'https:' && url.protocol !== 'http:') {
      bad.push(raw);
      continue;
    }
    if (url.origin !== origin) foreign++;
    resources.push(url.href);
  }
  if (bad.length) findings.push({ id: 'discovery.well-known.resource', severity: 'warn', message: `${bad.length} resource(s) in /.well-known/x402 are not absolute http(s) URLs: ${bad.slice(0, 3).join(', ')}`, fix: 'Use absolute URLs such as https://example.com/api/paid.' });
  if (foreign) findings.push({ id: 'discovery.well-known.foreign', severity: 'info', message: `${foreign} resource(s) in /.well-known/x402 are on another origin; they are probed as listed.` });
  return { resources: [...new Set(resources)], findings };
}

// ---------------------------------------------------------------------------------------------------------------
// x-payment-info

export interface PaymentInfoParse {
  price?: DocumentedPrice;
  protocols: string[];
  findings: Finding[];
}

/**
 * Parse one OpenAPI `x-payment-info`, e.g.
 * `{"protocols": [{"x402": {}}], "price": {"mode": "fixed", "currency": "USD", "amount": "0.01"}}`.
 *
 * Known pitfall: `protocols` must be an array of objects keyed by protocol name. Discovery parsers drop the whole
 * block when it is `["x402"]`, and `{"x402": []}` (what PHP's json_encode makes of an empty array) is not an object either.
 */
export function parsePaymentInfo(info: unknown, where: string): PaymentInfoParse {
  const findings: Finding[] = [];
  const protocols: string[] = [];
  const add = (id: string, severity: Severity, message: string, fix?: string) => findings.push(fix ? { id, severity, message, fix } : { id, severity, message });
  if (!isObject(info)) {
    add('discovery.payment-info.invalid', 'error', `${where}: x-payment-info is not an object.`);
    return { protocols, findings };
  }
  const list = info['protocols'];
  if (list === undefined) add('discovery.payment-info.protocols', 'warn', `${where}: x-payment-info has no "protocols".`, 'Add "protocols": [{"x402": {}}].');
  else if (!Array.isArray(list)) add('discovery.payment-info.protocols', 'error', `${where}: x-payment-info.protocols is not an array.`, 'Use "protocols": [{"x402": {}}].');
  else {
    const strings = list.filter((p) => typeof p === 'string') as string[];
    if (strings.length)
      add('discovery.payment-info.protocols', 'error', `${where}: x-payment-info.protocols holds strings (${strings.map((s) => JSON.stringify(s)).join(', ')}); discovery parsers expect objects keyed by protocol name and drop the block.`, 'Use "protocols": [{"x402": {}}] (in PHP: [["x402" => new \\stdClass()]]).');
    for (const p of list) {
      if (!isObject(p)) continue;
      for (const [name, value] of Object.entries(p)) {
        protocols.push(name);
        if (!isObject(value))
          add('discovery.payment-info.protocols', 'error', `${where}: x-payment-info.protocols entry "${name}" is ${JSON.stringify(value)}, not an object.`, `Use {"${name}": {}} - an empty array [] is not an empty object.`);
      }
    }
    if (!protocols.includes('x402') && !strings.includes('x402')) add('discovery.payment-info.no-x402', 'warn', `${where}: x-payment-info.protocols does not list x402.`, 'Add {"x402": {}} to "protocols".');
  }
  const price = parseDocumentedPrice(info['price']);
  if (info['price'] === undefined) add('discovery.payment-info.price', 'warn', `${where}: x-payment-info has no "price".`, 'Add "price": {"mode": "fixed", "currency": "USD", "amount": "0.01"}.');
  else if (!price) add('discovery.payment-info.price', 'error', `${where}: x-payment-info.price ${JSON.stringify(info['price']).slice(0, 120)} is not a readable USD price.`, 'Use {"mode": "fixed", "currency": "USD", "amount": "0.01"} or {"mode": "dynamic", "currency": "USD", "min": "0.01", "max": "0.10"}.');
  return price ? { price, protocols, findings } : { protocols, findings };
}

// ---------------------------------------------------------------------------------------------------------------
// OpenAPI

type Json = Record<string, unknown>;

function resolveRef(doc: Json, node: unknown, depth = 0): unknown {
  if (!isObject(node) || typeof node['$ref'] !== 'string' || depth > 10) return node;
  const ref = node['$ref'];
  if (!ref.startsWith('#/')) return {};
  let cur: unknown = doc;
  for (const part of ref.slice(2).split('/')) {
    const key = part.replace(/~1/g, '/').replace(/~0/g, '~');
    cur = isObject(cur) ? cur[key] : undefined;
  }
  return resolveRef(doc, cur, depth + 1);
}

/** A minimal value that satisfies a JSON schema: examples and defaults first, then required properties only. */
export function exampleFromSchema(schema: unknown, doc: Json = {}, depth = 0): unknown {
  const s = resolveRef(doc, schema);
  if (!isObject(s) || depth > 8) return undefined;
  if ('example' in s) return s['example'];
  if (Array.isArray(s['examples']) && s['examples'].length) return s['examples'][0];
  if ('default' in s) return s['default'];
  if ('const' in s) return s['const'];
  if (Array.isArray(s['enum']) && s['enum'].length) return s['enum'][0];
  for (const k of ['oneOf', 'anyOf']) {
    const alts = s[k];
    if (Array.isArray(alts) && alts.length) return exampleFromSchema(alts[0], doc, depth + 1);
  }
  if (Array.isArray(s['allOf'])) {
    const merged: Json = {};
    for (const part of s['allOf']) {
      const v = exampleFromSchema(part, doc, depth + 1);
      if (isObject(v)) Object.assign(merged, v);
    }
    return merged;
  }
  let type = s['type'];
  if (Array.isArray(type)) type = type.find((t) => t !== 'null') ?? type[0];
  if (type === undefined && isObject(s['properties'])) type = 'object';
  switch (type) {
    case 'object': {
      const out: Json = {};
      const props = isObject(s['properties']) ? s['properties'] : {};
      const required = Array.isArray(s['required']) ? (s['required'] as unknown[]) : [];
      for (const key of required) if (typeof key === 'string') out[key] = exampleFromSchema(props[key] ?? {}, doc, depth + 1) ?? 'example';
      return out;
    }
    case 'array': {
      const min = typeof s['minItems'] === 'number' ? s['minItems'] : 0;
      const item = exampleFromSchema(s['items'] ?? {}, doc, depth + 1);
      return Array.from({ length: min }, () => item);
    }
    case 'string':
      if (s['format'] === 'uri' || s['format'] === 'url') return 'https://example.com';
      if (s['format'] === 'email') return 'user@example.com';
      if (s['format'] === 'date') return '2026-01-01';
      return typeof s['minLength'] === 'number' && s['minLength'] > 7 ? 'x'.repeat(s['minLength']) : 'example';
    case 'integer':
    case 'number':
      return typeof s['minimum'] === 'number' ? s['minimum'] : 1;
    case 'boolean':
      return false;
    default:
      return undefined;
  }
}

export interface OpenApiParse {
  endpoints: PaidEndpoint[];
  paidOperations: number;
  findings: Finding[];
}

/** Collect paid operations (those with `x-payment-info`) from an OpenAPI 3.x document. */
export function parseOpenApi(doc: unknown, origin: string): OpenApiParse {
  const findings: Finding[] = [];
  const endpoints: PaidEndpoint[] = [];
  let paidOperations = 0;
  if (!isObject(doc) || (typeof doc['openapi'] !== 'string' && typeof doc['swagger'] !== 'string')) {
    findings.push({ id: 'discovery.openapi.invalid', severity: 'error', message: '/openapi.json is not an OpenAPI document (no "openapi" version field).' });
    return { endpoints, paidOperations, findings };
  }
  const paths = doc['paths'];
  if (!isObject(paths)) {
    findings.push({ id: 'discovery.openapi.invalid', severity: 'error', message: '/openapi.json has no "paths" object.' });
    return { endpoints, paidOperations, findings };
  }

  // the empty security requirement ("no auth needed, pay instead") must be {} - PHP's json_encode([]) gives []
  const checkSecurity = (sec: unknown, where: string) => {
    if (sec === undefined) return;
    if (!Array.isArray(sec)) {
      findings.push({ id: 'discovery.openapi.security', severity: 'error', message: `${where}: "security" is not an array.` });
      return;
    }
    if (sec.some((r) => Array.isArray(r)))
      findings.push({ id: 'discovery.openapi.security', severity: 'error', message: `${where}: "security" holds an array ([]) where a requirement object belongs; the empty requirement must be {}.`, fix: 'Encode the "no authentication" requirement as {} (in PHP: new \\stdClass()).' });
  };
  checkSecurity(doc['security'], 'top level');

  let base = origin;
  const servers = doc['servers'];
  if (Array.isArray(servers) && isObject(servers[0]) && typeof servers[0]['url'] === 'string') {
    try {
      base = new URL(servers[0]['url'], origin + '/').href.replace(/\/$/, '');
    } catch {
      /* keep origin */
    }
  }

  let templated = 0;
  let no402 = 0;
  for (const [path, item] of Object.entries(paths)) {
    if (!isObject(item)) continue;
    let chosen: PaidEndpoint | undefined;
    for (const method of METHODS) {
      const op = item[method.toLowerCase()];
      if (!isObject(op)) continue;
      checkSecurity(op['security'], `${method} ${path}`);
      if (!('x-payment-info' in op)) continue;
      paidOperations++;
      const where = `${method} ${path}`;
      const info = parsePaymentInfo(op['x-payment-info'], where);
      findings.push(...info.findings);
      const responses = isObject(op['responses']) ? op['responses'] : {};
      if (!('402' in responses)) no402++;
      if (chosen && chosen.method === 'GET') continue; // one probe per path; GET preferred

      // fill path and required query parameters from examples
      const params = [...(Array.isArray(item['parameters']) ? item['parameters'] : []), ...(Array.isArray(op['parameters']) ? op['parameters'] : [])].map((p) => resolveRef(doc, p));
      let filled = path;
      let unresolved = false;
      const query = new URLSearchParams();
      for (const p of params) {
        if (!isObject(p) || typeof p['name'] !== 'string') continue;
        const schema = { ...(isObject(resolveRef(doc, p['schema'])) ? (resolveRef(doc, p['schema']) as Json) : {}), ...('example' in p ? { example: p['example'] } : {}) };
        const value = exampleFromSchema(schema, doc);
        if (p['in'] === 'path') {
          // a path value must be documented: a placeholder would likely answer 404 and be blamed on the seller
          const documented = ['example', 'examples', 'default', 'enum', 'const'].some((k) => k in schema);
          if (!documented || value === undefined || value === null || typeof value === 'object') unresolved = true;
          else filled = filled.replace(`{${p['name']}}`, encodeURIComponent(String(value)));
        } else if (p['in'] === 'query' && p['required'] === true && value !== undefined && typeof value !== 'object') query.set(p['name'], String(value));
      }
      if (unresolved || /\{[^}]+\}/.test(filled)) {
        templated++;
        continue;
      }
      let body: unknown;
      if (method !== 'GET' && method !== 'DELETE') {
        const rb = resolveRef(doc, op['requestBody']);
        const content = isObject(rb) && isObject(rb['content']) ? rb['content'] : {};
        const json = content['application/json'];
        body = isObject(json) ? (exampleFromSchema(json['schema'] ?? {}, doc) ?? {}) : {};
      }
      const qs = query.toString();
      const ep: PaidEndpoint = { url: base + filled + (qs ? `?${qs}` : ''), method, sources: ['openapi'], openapiPath: path, protocols: info.protocols };
      if (info.price) ep.price = info.price;
      if (body !== undefined) ep.body = body;
      chosen = ep;
    }
    if (chosen) endpoints.push(chosen);
  }
  if (paidOperations === 0)
    findings.push({ id: 'discovery.openapi.no-paid-operations', severity: 'warn', message: '/openapi.json has no operation with x-payment-info; directories that read OpenAPI will not list any paid endpoint.', fix: 'Add "x-payment-info": {"protocols": [{"x402": {}}], "price": {...}} to each paid operation.' });
  if (no402) findings.push({ id: 'discovery.openapi.no-402-response', severity: 'info', message: `${no402} paid operation(s) do not document a 402 response.`, fix: 'Document the 402 and its PAYMENT-REQUIRED header under "responses".' });
  if (templated) findings.push({ id: 'discovery.openapi.templated', severity: 'info', message: `${templated} paid path(s) have path parameters without examples and were not probed.`, fix: 'Add parameter examples, or pass the concrete URL with --endpoint.' });
  return { endpoints, paidOperations, findings };
}

// ---------------------------------------------------------------------------------------------------------------
// fetch both and merge

const pathKey = (u: string) => {
  try {
    const url = new URL(u);
    return url.origin + url.pathname.replace(/\/+$/, '');
  } catch {
    return u;
  }
};

export async function discover(ctx: HttpContext, origin: string, extra: string[] = [], maxEndpoints = 50): Promise<DiscoveryResult> {
  const findings: Finding[] = [];
  const wkUrl = `${origin}/.well-known/x402`;
  const oaUrl = `${origin}/openapi.json`;
  const [wk, oa] = await Promise.all([request(ctx, wkUrl), request(ctx, oaUrl)]);
  const result: DiscoveryResult = {
    wellKnown: { url: wkUrl, ok: false, resources: [] },
    openapi: { url: oaUrl, ok: false, paidOperations: 0 },
    endpoints: [],
    findings
  };
  if (wk.status !== undefined) result.wellKnown.status = wk.status;
  if (oa.status !== undefined) result.openapi.status = oa.status;

  const fetchProblem = (name: string, res: typeof wk, id: string) => {
    if (res.error) return findings.push({ id, severity: 'warn', message: `${name} could not be fetched: ${res.error}.` });
    const wall = looksLikeBotWall(res);
    if (wall) return findings.push({ id, severity: 'warn', message: `${name} answered ${res.status} from ${wall}; scripted clients and agents get the same.`, fix: 'Exempt discovery documents and paid endpoints from bot challenges.' });
    if (res.status === 404) return findings.push({ id, severity: 'warn', message: `${name} not found (404).` });
    return findings.push({ id, severity: 'warn', message: `${name} answered HTTP ${res.status}.` });
  };

  // well-known
  if (wk.status === 200) {
    const parsed = parseJson(wk.text);
    if (!parsed.ok) findings.push({ id: 'discovery.well-known.invalid', severity: 'error', message: '/.well-known/x402 is not valid JSON.' });
    else {
      const p = parseWellKnown(parsed.value, origin);
      findings.push(...p.findings);
      result.wellKnown.resources = p.resources;
      result.wellKnown.ok = !p.findings.some((f) => f.id === 'discovery.well-known.invalid');
    }
  } else fetchProblem('/.well-known/x402', wk, 'discovery.well-known.missing');

  // openapi
  let fromOpenApi: PaidEndpoint[] = [];
  if (oa.status === 200) {
    const parsed = parseJson(oa.text);
    if (!parsed.ok) findings.push({ id: 'discovery.openapi.invalid', severity: 'error', message: '/openapi.json is not valid JSON.' });
    else {
      const p = parseOpenApi(parsed.value, origin);
      findings.push(...p.findings);
      fromOpenApi = p.endpoints;
      result.openapi.paidOperations = p.paidOperations;
      result.openapi.ok = !p.findings.some((f) => f.id === 'discovery.openapi.invalid');
    }
  } else fetchProblem('/openapi.json', oa, 'discovery.openapi.missing');

  // merge: OpenAPI endpoints carry method, price and body; well-known adds URLs
  const byKey = new Map<string, PaidEndpoint>();
  for (const ep of fromOpenApi) byKey.set(pathKey(ep.url), ep);
  let notInOpenApi = 0;
  for (const url of result.wellKnown.resources) {
    const key = pathKey(url);
    const hit = byKey.get(key);
    if (hit) hit.sources.push('well-known');
    else {
      if (result.openapi.ok) notInOpenApi++;
      byKey.set(key, { url, method: 'GET', sources: ['well-known'] });
    }
  }
  if (notInOpenApi) findings.push({ id: 'discovery.well-known.not-in-openapi', severity: 'info', message: `${notInOpenApi} resource(s) in /.well-known/x402 have no paid operation in /openapi.json (probed with GET).` });
  if (result.wellKnown.ok && result.wellKnown.resources.length) {
    const missing = fromOpenApi.filter((ep) => !ep.sources.includes('well-known')).length;
    if (missing) findings.push({ id: 'discovery.openapi.not-in-well-known', severity: 'info', message: `${missing} paid OpenAPI operation(s) are not listed in /.well-known/x402.` });
  }

  let discovered = [...byKey.values()];
  if (discovered.length > maxEndpoints) {
    findings.push({ id: 'discovery.truncated', severity: 'info', message: `${discovered.length} paid endpoints found; probing the first ${maxEndpoints} (raise with --max-endpoints).` });
    discovered = discovered.slice(0, maxEndpoints);
  }

  // command-line endpoints always run
  for (const raw of extra) {
    const url = new URL(raw, origin + '/').href;
    const key = pathKey(url);
    const hit = byKey.get(key);
    if (hit) {
      hit.sources.push('cli');
      // a CLI URL with a query string replaces the discovered one
      if (url !== hit.url && new URL(url).search) hit.url = url;
      if (!discovered.includes(hit)) discovered.push(hit);
    } else {
      const ep: PaidEndpoint = { url, method: 'GET', sources: ['cli'] };
      byKey.set(key, ep);
      discovered.push(ep);
    }
  }

  if (discovered.length === 0)
    findings.push({ id: 'discovery.none', severity: 'error', message: 'No paid endpoint found: neither /.well-known/x402 nor /openapi.json lists one, and no --endpoint was given.', fix: 'Publish /.well-known/x402 and x-payment-info in /openapi.json, or pass --endpoint.' });
  result.endpoints = discovered;
  return result;
}
