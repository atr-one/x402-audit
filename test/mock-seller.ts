/**
 * An in-process x402 seller for tests (node:http on 127.0.0.1, a random port). `good` passes every check; `flawed`
 * carries the mistakes the audit is meant to catch. It also serves a facilitator discovery list at
 * /discovery/resources so the facilitator check can run offline.
 */
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { b64, goodPaymentRequired, PAY_TO_EVM, PAY_TO_SVM } from './fixtures.js';

export type Variant = 'good' | 'flawed';

export interface MockSeller {
  origin: string;
  requests: { method: string; url: string; headers: Record<string, string | string[] | undefined>; body: string }[];
  close: () => Promise<void>;
}

const PAY = { protocols: [{ x402: {} }], price: { mode: 'fixed', currency: 'USD', amount: '0.01' } };

function openapi(variant: Variant) {
  const pay = variant === 'good' ? PAY : { ...PAY, protocols: ['x402'] };
  return {
    openapi: '3.1.0',
    info: { title: 'Mock seller', version: '1.0.0' },
    security: variant === 'good' ? [{}, { bearer: [] }] : [[], { bearer: [] }],
    components: { securitySchemes: { bearer: { type: 'http', scheme: 'bearer' } } },
    paths: {
      '/api/search': {
        get: {
          operationId: 'search',
          parameters: [{ name: 'q', in: 'query', required: false, schema: { type: 'string' } }],
          'x-payment-info': pay,
          responses: { '200': { description: 'ok' }, '402': { description: 'Payment required' } }
        }
      },
      '/api/report': {
        post: {
          operationId: 'report',
          requestBody: { required: true, content: { 'application/json': { schema: { type: 'object', properties: { query: { type: 'string' }, pages: { type: 'integer', minimum: 1 } }, required: ['query'] } } } },
          'x-payment-info': { protocols: [{ x402: {} }], price: { mode: 'dynamic', currency: 'USD', min: '0.01', max: '0.05' } },
          responses: { '200': { description: 'ok' }, '402': { description: 'Payment required' } }
        }
      }
    }
  };
}

function searchRequired(origin: string, variant: Variant) {
  const pr = goodPaymentRequired(`${origin}/api/search`);
  if (variant === 'flawed') {
    const [base, eth, sol] = pr.accepts;
    base!.payTo = PAY_TO_EVM.toLowerCase();
    base!.amount = '20000';
    delete base!.extra;
    eth!.network = 'ethereum';
    sol!.amount = '0.01';
    delete pr.extensions;
  }
  return pr;
}

function reportRequired(origin: string) {
  const pr = goodPaymentRequired(`${origin}/api/report`);
  for (const a of pr.accepts) a.amount = '20000';
  const bazaar = pr.extensions?.['bazaar'] as { info: { input: Record<string, unknown> }; schema: { properties: { input: { properties: Record<string, unknown>; required: string[] } } } };
  bazaar.info.input = { type: 'http', method: 'POST', bodyType: 'json', body: { query: 'fintech' } };
  bazaar.schema.properties.input.properties = { type: { type: 'string', const: 'http' }, method: { type: 'string', enum: ['POST'] }, bodyType: { type: 'string', enum: ['json'] }, body: { type: 'object' } };
  bazaar.schema.properties.input.required = ['type', 'method', 'bodyType', 'body'];
  return pr;
}

const json = (res: ServerResponse, status: number, body: unknown, headers: Record<string, string> = {}) => {
  res.writeHead(status, { 'Content-Type': 'application/json', ...headers });
  res.end(JSON.stringify(body));
};

export async function startMockSeller(variant: Variant = 'good'): Promise<MockSeller> {
  const requests: MockSeller['requests'] = [];
  let origin = '';
  const cors = (): Record<string, string> =>
    variant === 'good'
      ? { 'Access-Control-Allow-Origin': '*', 'Access-Control-Expose-Headers': 'PAYMENT-REQUIRED, PAYMENT-RESPONSE' }
      : { 'Access-Control-Allow-Origin': '*' };

  const handle = (req: IncomingMessage, res: ServerResponse, body: string) => {
    const url = new URL(req.url ?? '/', origin);
    requests.push({ method: req.method ?? 'GET', url: url.href, headers: req.headers, body });
    if (url.pathname === '/.well-known/x402') {
      const resources = [`${origin}/api/search`, `${origin}/api/report`];
      if (variant === 'flawed') resources.push(`${origin}/api/legacy`);
      return json(res, 200, { version: 1, resources });
    }
    if (url.pathname === '/openapi.json') return json(res, 200, openapi(variant));

    // a v1 client
    if (req.headers['x-payment']) {
      if (variant === 'flawed') return json(res, 500, { error: 'internal error' });
      const pr = { ...searchRequired(origin, variant), error: 'x402 version 1 (X-PAYMENT) is not accepted: use v2 and the PAYMENT-SIGNATURE header' };
      return json(res, 402, { error: 'invalid_x402_version' }, { 'PAYMENT-REQUIRED': b64(pr), ...cors() });
    }
    if (req.headers['payment-signature']) return json(res, 402, { error: 'payments are not accepted by the mock' });

    if (url.pathname === '/api/search' && req.method === 'GET') {
      const pr = searchRequired(origin, variant);
      // (the flawed seller builds the body from another object than the header)
      const inBody = variant === 'good' ? pr : goodPaymentRequired(`${origin}/api/search`);
      return json(res, 402, { error: 'payment_required', x402: inBody }, { 'PAYMENT-REQUIRED': b64(pr), ...cors() });
    }
    if (url.pathname === '/api/report' && req.method === 'POST') {
      let parsed: unknown;
      try {
        parsed = JSON.parse(body);
      } catch {
        return json(res, 400, { error: 'invalid_json' });
      }
      if (typeof (parsed as { query?: unknown })?.query !== 'string') return json(res, 400, { error: 'query is required' });
      const pr = reportRequired(origin);
      return json(res, 402, { error: 'payment_required' }, { 'PAYMENT-REQUIRED': b64(pr), ...cors() });
    }
    if (url.pathname === '/api/legacy') {
      return json(res, 402, { x402Version: 1, error: 'X-PAYMENT header is required', accepts: [{ scheme: 'exact', network: 'base', maxAmountRequired: '10000', resource: `${origin}/api/legacy`, asset: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913', payTo: PAY_TO_EVM, maxTimeoutSeconds: 60 }] });
    }
    // a facilitator discovery list that knows /api/search, by checksummed payTo only
    if (url.pathname === '/discovery/resources') {
      const items = [PAY_TO_EVM, PAY_TO_SVM].includes(url.searchParams.get('payTo') ?? '') ? [{ resource: `${origin}/api/search`, type: 'http', x402Version: 2, accepts: [] }] : [];
      return json(res, 200, { x402Version: 2, items, pagination: { limit: 100, offset: 0, total: items.length } });
    }
    return json(res, 404, { error: 'not_found' });
  };

  const server = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on('data', (c: Buffer) => chunks.push(c));
    req.on('end', () => handle(req, res, Buffer.concat(chunks).toString('utf8')));
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  return {
    origin,
    requests,
    close: () => new Promise<void>((resolve, reject) => server.close((e) => (e ? reject(e) : resolve())))
  };
}
