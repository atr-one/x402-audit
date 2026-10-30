/**
 * The Bazaar discovery extension (`extensions.bazaar` of PaymentRequired): `info` (how to call the resource and an
 * example answer) and `schema` (a JSON Schema that `info` must satisfy). Facilitators that catalog resources read it
 * from the payment they verify or settle.
 */
import type { Finding, HttpMethod, PaymentRequired } from '../types.js';

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

/**
 * A small JSON Schema subset validator (type, const, enum, required, properties, additionalProperties: false, items).
 * Enough to catch an `info` that its own `schema` rejects; not a full implementation.
 */
export function miniValidate(value: unknown, schema: unknown, path = '$', errors: string[] = [], depth = 0): string[] {
  if (!isObject(schema) || depth > 12 || errors.length > 20) return errors;
  const t = schema['type'];
  if (typeof t === 'string' || Array.isArray(t)) {
    const types = (Array.isArray(t) ? t : [t]) as string[];
    const actual = value === null ? 'null' : Array.isArray(value) ? 'array' : typeof value;
    const ok = types.some((x) => x === actual || (x === 'integer' && typeof value === 'number' && Number.isInteger(value)));
    if (!ok) {
      errors.push(`${path} is ${actual}, schema wants ${types.join('|')}`);
      return errors;
    }
  }
  if ('const' in schema && JSON.stringify(schema['const']) !== JSON.stringify(value)) errors.push(`${path} must be ${JSON.stringify(schema['const'])}`);
  if (Array.isArray(schema['enum']) && !schema['enum'].some((e) => JSON.stringify(e) === JSON.stringify(value))) errors.push(`${path} must be one of ${JSON.stringify(schema['enum'])}`);
  if (isObject(value)) {
    const props = isObject(schema['properties']) ? schema['properties'] : {};
    if (Array.isArray(schema['required'])) for (const k of schema['required']) if (typeof k === 'string' && !(k in value)) errors.push(`${path}.${k} is required`);
    for (const [k, v] of Object.entries(value)) {
      if (k in props) miniValidate(v, props[k], `${path}.${k}`, errors, depth + 1);
      else if (schema['additionalProperties'] === false) errors.push(`${path}.${k} is not allowed (additionalProperties: false)`);
    }
  }
  if (Array.isArray(value) && isObject(schema['items'])) value.forEach((v, i) => miniValidate(v, schema['items'], `${path}[${i}]`, errors, depth + 1));
  return errors;
}

export function checkBazaar(pr: PaymentRequired, method: HttpMethod, headerBytes: number | undefined, endpoint?: string): Finding[] {
  const findings: Finding[] = [];
  const add = (f: Finding) => findings.push(endpoint ? { ...f, endpoint } : f);
  const ext = isObject(pr.extensions) ? pr.extensions : {};
  const bazaar = ext['bazaar'];
  if (bazaar === undefined) {
    add({ id: 'bazaar.missing', severity: 'warn', message: 'No extensions.bazaar: catalogs fed by facilitators (Bazaar) cannot show how to call this endpoint or what it returns.', fix: 'Add extensions.bazaar with info.input ({type: "http", method, queryParams|body}), info.output and a JSON schema for them.' });
    return findings;
  }
  if (!isObject(bazaar)) {
    add({ id: 'bazaar.shape', severity: 'error', message: 'extensions.bazaar is not an object.' });
    return findings;
  }
  const info = bazaar['info'];
  if (!isObject(info)) {
    add({ id: 'bazaar.shape', severity: 'warn', message: 'extensions.bazaar.info is missing.', fix: 'Add info.input and info.output.' });
    return findings;
  }
  const input = info['input'];
  if (!isObject(input)) add({ id: 'bazaar.shape', severity: 'warn', message: 'extensions.bazaar.info.input is missing.', fix: 'Describe the call: {"type": "http", "method": "GET", "queryParams": {...}}.' });
  else if (input['type'] === 'http') {
    const m = typeof input['method'] === 'string' ? input['method'].toUpperCase() : undefined;
    if (!m) add({ id: 'bazaar.shape', severity: 'warn', message: 'extensions.bazaar.info.input has type "http" but no method.' });
    else if (m !== method) add({ id: 'bazaar.method', severity: 'warn', message: `extensions.bazaar.info.input.method is ${m}, but the endpoint was probed with ${method}.`, fix: 'Describe the method the 402 was answered for.' });
    if (m === 'POST' && !('body' in input)) add({ id: 'bazaar.shape', severity: 'info', message: 'extensions.bazaar.info.input is a POST without a "body" example.' });
  } else if (input['type'] === 'mcp') {
    if (typeof input['toolName'] !== 'string') add({ id: 'bazaar.shape', severity: 'warn', message: 'extensions.bazaar.info.input has type "mcp" but no toolName.' });
  } else add({ id: 'bazaar.shape', severity: 'warn', message: `extensions.bazaar.info.input.type is ${JSON.stringify(input['type'])}; known types are "http" and "mcp".` });
  if (!isObject(info['output'])) add({ id: 'bazaar.output', severity: 'info', message: 'extensions.bazaar.info.output is missing; catalogs show no example answer.' });

  const schema = bazaar['schema'];
  if (schema === undefined) add({ id: 'bazaar.schema', severity: 'info', message: 'extensions.bazaar.schema is missing; facilitators that validate info against it may skip the entry.' });
  else if (!isObject(schema) || (schema['type'] !== undefined && schema['type'] !== 'object')) add({ id: 'bazaar.schema', severity: 'warn', message: 'extensions.bazaar.schema is not an object schema.' });
  else {
    const errors = miniValidate(info, schema, 'info');
    if (errors.length) add({ id: 'bazaar.schema', severity: 'warn', message: `extensions.bazaar.info does not satisfy its own schema: ${errors.slice(0, 3).join('; ')}${errors.length > 3 ? ` (+${errors.length - 3} more)` : ''}.`, fix: 'Build info and schema from the same definitions.' });
  }

  if (headerBytes !== undefined) {
    const share = Buffer.byteLength(Buffer.from(JSON.stringify(bazaar)).toString('base64'));
    if (headerBytes > 8 * 1024 && share > headerBytes / 2) add({ id: 'bazaar.size', severity: 'info', message: `The bazaar extension is about ${Math.round((share / headerBytes) * 100)}% of the PAYMENT-REQUIRED header.` });
  }
  return findings;
}
