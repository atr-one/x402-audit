import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { audit, exitCode, formatConsole, formatMarkdown, priceRows } from '../src/index.js';
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
    expect(text).toMatch(/Prices\n +Endpoint +Method +Network +Price \(USD\) +Asset\n +\/api\/search +GET +Base +\$0\.01 +USDC\n/);
    expect(text).not.toContain('\x1b[');
    expect(text).not.toContain('Networks:');
    const md = formatMarkdown(report);
    expect(md).toContain('| 402 | POST |');
    expect(md).toContain('| Endpoint | Method | Network | Price (USD) | Asset |');
    expect(md).toContain('| `/api/search` | GET | Base | $0.01 | USDC |');
    expect(md).toContain('| `/api/report` | POST | Solana | $0.02 | USDC |');
  });

  it('lists every offer in the price table', async () => {
    const report = await audit(seller.origin, { probeV1: false });
    expect(priceRows(report).map((r) => [new URL(r.endpoint).pathname, r.method, r.networkName, r.priceUsd, r.symbol])).toEqual([
      ['/api/search', 'GET', 'Base', '0.01', 'USDC'],
      ['/api/search', 'GET', 'Ethereum', '0.01', 'USDC'],
      ['/api/search', 'GET', 'Solana', '0.01', 'USDC'],
      ['/api/report', 'POST', 'Base', '0.02', 'USDC'],
      ['/api/report', 'POST', 'Ethereum', '0.02', 'USDC'],
      ['/api/report', 'POST', 'Solana', '0.02', 'USDC']
    ]);
  });

  it('audits and shows only the selected networks', async () => {
    const report = await audit(seller.origin, { probeV1: false, networks: ['base', 'solana'] });
    expect(report.networks).toEqual(['eip155:8453', 'solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp']);
    expect(new Set(priceRows(report).map((r) => r.networkName))).toEqual(new Set(['Base', 'Solana']));
    expect(formatConsole(report)).toContain('Networks: Base (eip155:8453), Solana (solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp)');
    expect(formatMarkdown(report)).toContain('Only offers on Base (eip155:8453), Solana');
    expect(report.findings.filter((f) => f.severity !== 'info')).toEqual([]);
  });

  it('reports an endpoint with no offer on the selected network', async () => {
    const report = await audit(seller.origin, { probeV1: false, networks: ['polygon'] });
    const missing = report.findings.filter((f) => f.id === 'network.not-offered');
    expect(missing.map((f) => [f.severity, new URL(f.endpoint ?? '').pathname])).toEqual([
      ['error', '/api/search'],
      ['error', '/api/report']
    ]);
    expect(missing[0]?.message).toContain('Polygon (eip155:137)');
    expect(priceRows(report)).toEqual([]);
    expect(formatConsole(report)).toMatch(/Prices\n {2}none\n/);
  });

  it('refuses an unknown network name', async () => {
    await expect(audit(seller.origin, { networks: ['nope'] })).rejects.toThrow(/unknown network "nope"/);
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

  it('leaves out the offers on other networks', async () => {
    const all = await audit(seller.origin, { probeV1: false });
    const search = (r: typeof all) => r.findings.filter((f) => f.endpoint?.endsWith('/api/search')).map((f) => f.id);
    expect(search(all)).toEqual(expect.arrayContaining(['pr.accept.network', 'pr.accept.amount', 'pr.accept.pay-to-checksum']));

    // Base: the lowercase payTo, the missing EIP-712 domain and the price stay; Ethereum's v1 name and Solana's decimal amount go
    const base = await audit(seller.origin, { probeV1: false, networks: ['base'] });
    expect(search(base)).toEqual(expect.arrayContaining(['pr.accept.pay-to-checksum', 'pr.accept.extra', 'price.mismatch']));
    expect(search(base)).not.toContain('pr.accept.network');
    expect(search(base)).not.toContain('pr.accept.amount');
    // the v1 endpoint's "base" offer counts as Base
    expect(base.findings.some((f) => f.id === 'pr.accept.network' && f.endpoint?.endsWith('/api/legacy'))).toBe(true);

    const eth = await audit(seller.origin, { probeV1: false, networks: ['ethereum'] });
    expect(search(eth)).toContain('pr.accept.network');
    expect(search(eth)).not.toContain('pr.accept.pay-to-checksum');
    expect(eth.findings.some((f) => f.id === 'network.not-offered' && f.endpoint?.endsWith('/api/legacy'))).toBe(true);
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
