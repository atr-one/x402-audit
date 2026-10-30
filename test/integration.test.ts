import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { audit, exitCode, formatConsole, formatMarkdown } from '../src/index.js';
import { DEFAULT_USER_AGENT } from '../src/http.js';
import { startMockSeller, type MockSeller } from './mock-seller.js';

describe('audit against a good mock seller', () => {
  let seller: MockSeller;
  beforeAll(async () => {
    seller = await startMockSeller('good');
  });
  afterAll(() => seller.close());

  it('finds both paid endpoints and reports no errors or warnings', async () => {
    const report = await audit(seller.origin, { facilitatorDiscovery: true, facilitatorUrl: seller.origin });
    const noisy = report.findings.filter((f) => f.severity !== 'info');
    expect(noisy).toEqual([]);
    expect(report.endpoints.map((e) => [e.method, new URL(e.url).pathname, e.status])).toEqual([
      ['GET', '/api/search', 402],
      ['POST', '/api/report', 402]
    ]);
    expect(report.discovery.wellKnown.resources).toHaveLength(2);
    expect(report.discovery.openapi.paidOperations).toBe(2);
    expect(report.facilitator?.[0]?.listed).toEqual([`${seller.origin}/api/search`]);
    expect(report.findings.map((f) => f.id)).toEqual(expect.arrayContaining(['hygiene.v1', 'facilitator.listed']));
    expect(exitCode(report, 'warn')).toBe(0);
  });

  it('sends the documented method and a JSON body built from the schema, never a payment', async () => {
    const posts = seller.requests.filter((r) => r.method === 'POST');
    expect(posts.length).toBeGreaterThan(0);
    expect(JSON.parse(posts[0]!.body)).toEqual({ query: 'example' });
    expect(posts[0]!.headers['content-type']).toBe('application/json');
    expect(seller.requests.every((r) => !r.headers['payment-signature'])).toBe(true);
    expect(seller.requests.every((r) => r.headers['user-agent'] === DEFAULT_USER_AGENT)).toBe(true);
  });

  it('formats text and Markdown reports', async () => {
    const report = await audit(seller.origin, { probeV1: false });
    const text = formatConsole(report);
    expect(text).toContain('/api/search');
    expect(text).toContain('Base $0.01');
    expect(text).not.toContain('\x1b[');
    expect(formatMarkdown(report)).toContain('| 402 | POST |');
  });
});

describe('audit against a flawed mock seller', () => {
  let seller: MockSeller;
  beforeAll(async () => {
    seller = await startMockSeller('flawed');
  });
  afterAll(() => seller.close());

  it('reports the planted mistakes', async () => {
    const report = await audit(seller.origin, { facilitatorDiscovery: true, facilitatorUrl: seller.origin });
    const ids = new Set(report.findings.map((f) => `${f.severity}:${f.id}`));
    for (const expected of [
      'error:discovery.payment-info.protocols',
      'error:discovery.openapi.security',
      'error:http.payment-required-header',
      'error:pr.version',
      'error:pr.accept.network',
      'error:pr.accept.amount',
      'warn:pr.accept.pay-to-checksum',
      'warn:pr.accept.extra',
      'warn:price.mismatch',
      'warn:bazaar.missing',
      'warn:hygiene.cors-expose',
      'warn:hygiene.v1',
      'warn:pr.body-mismatch',
      'info:facilitator.case'
    ])
      expect(ids, expected).toContain(expected);
    expect(exitCode(report, 'error')).toBe(1);
    expect(report.summary.error).toBeGreaterThan(0);
  });

  it('probes an explicit endpoint and reports a 404 as a status error', async () => {
    const report = await audit(seller.origin, { endpoints: ['/api/missing'], probeV1: false });
    const f = report.findings.find((x) => x.id === 'http.status' && x.endpoint?.endsWith('/api/missing'));
    expect(f?.severity).toBe('error');
  });

  it('reports an unreachable origin without throwing', async () => {
    const report = await audit('http://127.0.0.1:9', { timeoutMs: 2000 });
    expect(report.findings.map((f) => f.id)).toEqual(expect.arrayContaining(['discovery.well-known.missing', 'discovery.openapi.missing', 'discovery.none']));
    expect(exitCode(report)).toBe(1);
  });
});
