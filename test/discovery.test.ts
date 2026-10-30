import { describe, expect, it } from 'vitest';
import { exampleFromSchema, normaliseOrigin, parseOpenApi, parsePaymentInfo, parseWellKnown } from '../src/discovery.js';

const ORIGIN = 'https://seller.example';
const PAY = { protocols: [{ x402: {} }], price: { mode: 'fixed', currency: 'USD', amount: '0.01' } };

describe('parsePaymentInfo', () => {
  it('reads a correct block', () => {
    const r = parsePaymentInfo(PAY, 'GET /a');
    expect(r.findings).toEqual([]);
    expect(r.protocols).toEqual(['x402']);
    expect(r.price).toEqual({ mode: 'fixed', amount: 0.01 });
  });

  it('flags protocols given as strings (the discovery parser drops the block)', () => {
    const r = parsePaymentInfo({ ...PAY, protocols: ['x402'] }, 'GET /a');
    expect(r.findings.map((f) => [f.id, f.severity])).toEqual([['discovery.payment-info.protocols', 'error']]);
    expect(r.findings[0]?.fix).toContain('[{"x402": {}}]');
  });

  it('flags {"x402": []} (an empty PHP array) and a non-array', () => {
    const r = parsePaymentInfo({ ...PAY, protocols: [{ x402: [] }] }, 'GET /a');
    expect(r.findings.map((f) => f.id)).toEqual(['discovery.payment-info.protocols']);
    expect(r.findings[0]?.message).toContain('[]');
    expect(parsePaymentInfo({ ...PAY, protocols: { x402: {} } }, 'x').findings[0]?.severity).toBe('error');
  });

  it('warns when x402 is not among the protocols and when price is missing or bad', () => {
    expect(parsePaymentInfo({ ...PAY, protocols: [{ mpp: {} }] }, 'x').findings.map((f) => f.id)).toEqual(['discovery.payment-info.no-x402']);
    expect(parsePaymentInfo({ protocols: [{ x402: {} }] }, 'x').findings.map((f) => f.severity)).toEqual(['warn']);
    expect(parsePaymentInfo({ protocols: [{ x402: {} }], price: { mode: 'fixed', amount: 'cheap' } }, 'x').findings.map((f) => f.severity)).toEqual(['error']);
  });
});

describe('parseOpenApi', () => {
  const doc = {
    openapi: '3.1.0',
    info: { title: 't', version: '1' },
    security: [{}, { bearer: [] }],
    components: { schemas: { Report: { type: 'object', properties: { query: { type: 'string' }, depth: { type: 'integer', minimum: 1 }, note: { type: 'string' } }, required: ['query', 'depth'] } } },
    paths: {
      '/api/search': {
        get: { 'x-payment-info': PAY, parameters: [{ name: 'q', in: 'query', required: true, schema: { type: 'string', example: 'fintech' } }], responses: { '402': { description: 'pay' } } },
        post: { 'x-payment-info': PAY, responses: {} }
      },
      '/api/report': {
        post: {
          'x-payment-info': { protocols: [{ x402: {} }], price: { mode: 'dynamic', currency: 'USD', min: '0.01', max: '0.05' } },
          requestBody: { content: { 'application/json': { schema: { $ref: '#/components/schemas/Report' } } } },
          responses: { '402': {} }
        }
      },
      '/api/item/{id}': { get: { 'x-payment-info': PAY, parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }], responses: {} } },
      '/api/thing/{slug}': { get: { 'x-payment-info': PAY, parameters: [{ name: 'slug', in: 'path', required: true, example: 'abc', schema: { type: 'string' } }], responses: { '402': {} } } },
      '/free': { get: { responses: {} } }
    }
  };

  it('collects paid operations, prefers GET, fills required query and path parameters', () => {
    const r = parseOpenApi(doc, ORIGIN);
    expect(r.paidOperations).toBe(5);
    const byPath = Object.fromEntries(r.endpoints.map((e) => [e.openapiPath, e]));
    expect(byPath['/api/search']).toMatchObject({ method: 'GET', url: `${ORIGIN}/api/search?q=fintech`, price: { mode: 'fixed', amount: 0.01 } });
    expect(byPath['/api/report']).toMatchObject({ method: 'POST', body: { query: 'example', depth: 1 }, price: { mode: 'dynamic', min: 0.01, max: 0.05 } });
    expect(byPath['/api/thing/{slug}']?.url).toBe(`${ORIGIN}/api/thing/abc`);
    expect(byPath['/api/item/{id}']).toBeUndefined();
    const ids = r.findings.map((f) => f.id);
    expect(ids).toContain('discovery.openapi.templated');
    expect(ids).toContain('discovery.openapi.no-402-response');
    expect(ids.filter((i) => i.startsWith('discovery.openapi.security'))).toEqual([]);
  });

  it('flags an empty security requirement encoded as []', () => {
    const bad = { ...doc, security: [[], { bearer: [] }] };
    const f = parseOpenApi(bad, ORIGIN).findings.find((x) => x.id === 'discovery.openapi.security');
    expect(f?.severity).toBe('error');
    expect(f?.fix).toContain('{}');
  });

  it('uses servers[0].url as the base', () => {
    const r = parseOpenApi({ ...doc, servers: [{ url: '/v1' }] }, ORIGIN);
    expect(r.endpoints[0]?.url.startsWith(`${ORIGIN}/v1/api/`)).toBe(true);
  });

  it('reports documents that are not OpenAPI or have no paid operation', () => {
    expect(parseOpenApi({ hello: 1 }, ORIGIN).findings[0]?.id).toBe('discovery.openapi.invalid');
    expect(parseOpenApi({ openapi: '3.0.0', paths: { '/a': { get: {} } } }, ORIGIN).findings.map((f) => f.id)).toEqual(['discovery.openapi.no-paid-operations']);
  });
});

describe('parseWellKnown', () => {
  it('reads resource URLs', () => {
    const r = parseWellKnown({ version: 1, resources: [`${ORIGIN}/a`, `${ORIGIN}/a`, { url: `${ORIGIN}/b` }, 'https://other.example/c'] }, ORIGIN);
    expect(r.resources).toEqual([`${ORIGIN}/a`, `${ORIGIN}/b`, 'https://other.example/c']);
    expect(r.findings.map((f) => f.id)).toEqual(['discovery.well-known.foreign']);
  });

  it('flags bad documents and entries', () => {
    expect(parseWellKnown([], ORIGIN).findings[0]?.severity).toBe('error');
    expect(parseWellKnown({ version: 1 }, ORIGIN).findings[0]?.id).toBe('discovery.well-known.invalid');
    expect(parseWellKnown({ resources: ['/relative', 42] }, ORIGIN).findings.map((f) => f.id)).toEqual(['discovery.well-known.resource']);
  });
});

describe('helpers', () => {
  it('builds minimal values from schemas', () => {
    expect(exampleFromSchema({ type: 'object', properties: { a: { type: 'string' }, b: { type: 'number' } }, required: ['a'] })).toEqual({ a: 'example' });
    expect(exampleFromSchema({ type: 'string', enum: ['x', 'y'] })).toBe('x');
    expect(exampleFromSchema({ type: ['null', 'integer'], minimum: 5 })).toBe(5);
    expect(exampleFromSchema({ type: 'array', minItems: 1, items: { type: 'boolean' } })).toEqual([false]);
    expect(exampleFromSchema({ oneOf: [{ type: 'string', format: 'uri' }] })).toBe('https://example.com');
  });

  it('normalises origins', () => {
    expect(normaliseOrigin('example.com')).toBe('https://example.com');
    expect(normaliseOrigin('http://localhost:8080/some/path?x=1')).toBe('http://localhost:8080');
  });
});
