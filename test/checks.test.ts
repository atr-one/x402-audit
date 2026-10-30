import { describe, expect, it } from 'vitest';
import { checkBazaar, miniValidate } from '../src/checks/bazaar.js';
import { checkCors, checkLatency, classifyV1 } from '../src/checks/hygiene.js';
import { compareRequirements, paymentRequiredInBody } from '../src/checks/response.js';
import { listedResources } from '../src/checks/facilitator.js';
import type { HttpResult } from '../src/http.js';
import { b64, clone, goodPaymentRequired } from './fixtures.js';

describe('bazaar', () => {
  it('accepts a consistent extension', () => {
    expect(checkBazaar(goodPaymentRequired(), 'GET', 2000)).toEqual([]);
  });

  it('flags a missing extension, a method mismatch and info that fails its own schema', () => {
    const pr = clone(goodPaymentRequired());
    delete pr.extensions;
    expect(checkBazaar(pr, 'GET', 100).map((f) => f.id)).toEqual(['bazaar.missing']);
    expect(checkBazaar(goodPaymentRequired(), 'POST', 100).map((f) => f.id)).toEqual(['bazaar.method']);
    const extra = clone(goodPaymentRequired());
    ((extra.extensions!['bazaar'] as { info: { input: Record<string, unknown> } }).info.input)['headers'] = { a: 'b' };
    const f = checkBazaar(extra, 'GET', 100).find((x) => x.id === 'bazaar.schema');
    expect(f?.message).toContain('additionalProperties');
  });

  it('validates the JSON Schema subset', () => {
    const schema = { type: 'object', properties: { a: { type: 'integer' }, b: { enum: ['x'] }, c: { type: 'array', items: { type: 'string' } } }, required: ['a'], additionalProperties: false };
    expect(miniValidate({ a: 1, b: 'x', c: ['y'] }, schema)).toEqual([]);
    expect(miniValidate({ a: 1.5, b: 'z', c: [1], d: 0 }, schema)).toHaveLength(4);
    expect(miniValidate({}, schema)).toEqual(['$.a is required']);
  });
});

const res = (status: number | undefined, text = '', headers: Record<string, string> = {}, error?: string): HttpResult =>
  ({ url: 'https://x', status, text, headers: new Headers(headers), timeMs: 1, ...(error ? { error } : {}) }) as HttpResult;

describe('hygiene', () => {
  it('checks CORS exposure', () => {
    expect(checkCors(new Headers({ 'access-control-allow-origin': '*', 'access-control-expose-headers': 'payment-required, PAYMENT-RESPONSE' }))).toEqual([]);
    expect(checkCors(new Headers({ 'access-control-allow-origin': '*', 'access-control-expose-headers': '*' }))).toEqual([]);
    expect(checkCors(new Headers({ 'access-control-allow-origin': '*', 'access-control-expose-headers': 'PAYMENT-REQUIRED' }))[0]?.message).toContain('PAYMENT-RESPONSE');
    expect(checkCors(new Headers())[0]?.id).toBe('hygiene.cors-origin');
  });

  it('grades latency', () => {
    expect(checkLatency(300)).toEqual([]);
    expect(checkLatency(2500)[0]?.severity).toBe('info');
    expect(checkLatency(6000)[0]?.severity).toBe('warn');
  });

  it('classifies answers to a v1 X-PAYMENT', () => {
    expect(classifyV1(res(200)).severity).toBe('error');
    expect(classifyV1(res(500)).severity).toBe('warn');
    expect(classifyV1(res(402, '{"error":"use x402 v2"}')).fix).toBeUndefined();
    expect(classifyV1(res(402, '{}', { 'payment-required': b64({ error: 'PAYMENT-SIGNATURE is required' }) })).fix).toBeUndefined();
    expect(classifyV1(res(402, '{}')).fix).toBeDefined();
  });
});

describe('body consistency', () => {
  it('finds a PaymentRequired in the body and compares offers', () => {
    const pr = goodPaymentRequired();
    expect(paymentRequiredInBody({ x402: pr })).toBe(pr);
    expect(paymentRequiredInBody(pr)).toBe(pr);
    expect(paymentRequiredInBody({ error: 'x' })).toBeUndefined();
    expect(compareRequirements(pr, clone(pr))).toBe('');
    const other = clone(pr);
    other.accepts[0]!.amount = '20000';
    expect(compareRequirements(pr, other)).toBe('1 offer(s) only in the header, 1 only in the body');
    // EVM addresses compare case-insensitively
    const lower = clone(pr);
    lower.accepts[0]!.payTo = lower.accepts[0]!.payTo.toLowerCase();
    expect(compareRequirements(pr, lower)).toBe('');
  });
});

describe('facilitator discovery answers', () => {
  it('reads items and pagination', () => {
    expect(listedResources({ items: [{ resource: 'https://a/x' }, { resource: { url: 'https://a/y' } }], pagination: { total: 7 } })).toEqual({ urls: ['https://a/x', 'https://a/y'], total: 7 });
    expect(listedResources({ resources: ['https://a/z'] })).toEqual({ urls: ['https://a/z'] });
    expect(listedResources(null)).toEqual({ urls: [] });
  });
});
