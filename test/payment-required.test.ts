import { describe, expect, it } from 'vitest';
import { decodePaymentRequired, validatePaymentRequired } from '../src/payment-required.js';
import { b64, clone, goodPaymentRequired, PAY_TO_EVM } from './fixtures.js';

const ids = (v: { findings: { id: string; severity: string }[] }, severity?: string) => v.findings.filter((f) => !severity || f.severity === severity).map((f) => f.id);

describe('decodePaymentRequired', () => {
  it('decodes standard base64 JSON', () => {
    const pr = goodPaymentRequired();
    const d = decodePaymentRequired(b64(pr));
    expect(d.ok).toBe(true);
    if (d.ok) {
      expect(d.value).toEqual(pr);
      expect(d.encoding).toBe('base64');
    }
  });

  it('decodes base64url and says so', () => {
    const raw = Buffer.from(JSON.stringify({ s: '>>>???' })).toString('base64url');
    const d = decodePaymentRequired(raw);
    expect(d.ok && d.encoding).toBe('base64url');
  });

  it('refuses plain JSON, garbage and empty values', () => {
    const plain = decodePaymentRequired('{"x402Version":2}');
    expect(plain.ok).toBe(false);
    if (!plain.ok) expect(plain.plainJson).toEqual({ x402Version: 2 });
    expect(decodePaymentRequired('not base64!').ok).toBe(false);
    expect(decodePaymentRequired(Buffer.from('not json').toString('base64')).ok).toBe(false);
    expect(decodePaymentRequired('  ').ok).toBe(false);
  });
});

describe('validatePaymentRequired', () => {
  it('passes a good object with no findings', () => {
    const v = validatePaymentRequired(goodPaymentRequired());
    expect(v.findings).toEqual([]);
    expect(v.valid).toBe(true);
  });

  it('rejects non-objects and missing accepts', () => {
    expect(validatePaymentRequired('x').valid).toBe(false);
    expect(validatePaymentRequired([]).valid).toBe(false);
    const pr = clone(goodPaymentRequired()) as Record<string, unknown>;
    delete pr['accepts'];
    expect(ids(validatePaymentRequired(pr), 'error')).toContain('pr.accepts');
    expect(ids(validatePaymentRequired({ ...goodPaymentRequired(), accepts: [] }), 'error')).toContain('pr.accepts');
  });

  it('flags a v1 object', () => {
    const v1 = {
      x402Version: 1,
      accepts: [{ scheme: 'exact', network: 'base', maxAmountRequired: '10000', resource: 'https://x/y', asset: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913', payTo: PAY_TO_EVM, maxTimeoutSeconds: 60 }]
    };
    const v = validatePaymentRequired(v1);
    expect(v.valid).toBe(false);
    expect(ids(v, 'error')).toEqual(expect.arrayContaining(['pr.version', 'pr.resource', 'pr.accept.network', 'pr.accept.amount']));
    expect(v.findings.find((f) => f.id === 'pr.accept.network')?.fix).toContain('eip155:8453');
    expect(v.findings.find((f) => f.id === 'pr.accept.amount')?.fix).toContain('amount');
  });

  it('flags amounts that are numbers, decimals, zero or padded', () => {
    for (const amount of [10000, '0.01', '0', '010000', '-1', '1e4', '']) {
      const pr = clone(goodPaymentRequired());
      (pr.accepts[0] as Record<string, unknown>)['amount'] = amount;
      expect(ids(validatePaymentRequired(pr), 'error'), String(amount)).toContain('pr.accept.amount');
    }
    const pr = clone(goodPaymentRequired());
    pr.accepts[0]!.amount = '0.01';
    expect(validatePaymentRequired(pr).findings.find((f) => f.id === 'pr.accept.amount')?.fix).toContain('atomic');
  });

  it('flags networks that are not CAIP-2', () => {
    const pr = clone(goodPaymentRequired());
    pr.accepts[0]!.network = 'Base Mainnet';
    expect(ids(validatePaymentRequired(pr), 'error')).toContain('pr.accept.network');
    pr.accepts[0]!.network = 'eip155:999999';
    const v = validatePaymentRequired(pr);
    expect(ids(v, 'info')).toContain('pr.accept.network-unknown');
    expect(v.valid).toBe(true);
  });

  it('checks payTo checksums', () => {
    const pr = clone(goodPaymentRequired());
    pr.accepts[0]!.payTo = PAY_TO_EVM.toLowerCase();
    expect(ids(validatePaymentRequired(pr), 'warn')).toContain('pr.accept.pay-to-checksum');
    pr.accepts[0]!.payTo = '0x5AAeb6053F3E94C9b9A09f33669435E7Ef1BeAed';
    expect(ids(validatePaymentRequired(pr), 'error')).toContain('pr.accept.pay-to');
    pr.accepts[0]!.payTo = '0x0000000000000000000000000000000000000000';
    expect(ids(validatePaymentRequired(pr), 'error')).toContain('pr.accept.pay-to');
    pr.accepts[2]!.payTo = PAY_TO_EVM; // EVM address on Solana
    expect(validatePaymentRequired(pr).findings.some((f) => f.id === 'pr.accept.pay-to' && f.message.includes('accepts[2]'))).toBe(true);
  });

  it('flags an asset that is not the canonical USDC', () => {
    const pr = clone(goodPaymentRequired());
    pr.accepts[0]!.asset = '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48'; // Ethereum USDC on Base
    expect(ids(validatePaymentRequired(pr), 'warn')).toContain('pr.accept.asset-unknown');
    pr.accepts[2]!.asset = '4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU'; // devnet mint on mainnet
    expect(validatePaymentRequired(pr).findings.filter((f) => f.id === 'pr.accept.asset-unknown')).toHaveLength(2);
  });

  it('checks the EIP-712 domain and the Solana fee payer', () => {
    const pr = clone(goodPaymentRequired());
    delete pr.accepts[0]!.extra;
    pr.accepts[1]!.extra = { name: 'USDC', version: '2' };
    delete pr.accepts[2]!.extra;
    const v = validatePaymentRequired(pr);
    const extra = v.findings.filter((f) => f.id === 'pr.accept.extra');
    expect(extra).toHaveLength(3);
    expect(extra[0]?.fix).toContain('"USD Coin"');
    expect(extra[1]?.message).toContain('wrong domain');
    expect(extra[2]?.message).toContain('feePayer');
  });

  it('checks maxTimeoutSeconds and the resource', () => {
    const pr = clone(goodPaymentRequired()) as unknown as Record<string, unknown>;
    const accepts = pr['accepts'] as Record<string, unknown>[];
    accepts[0]!['maxTimeoutSeconds'] = 3;
    accepts[1]!['maxTimeoutSeconds'] = 86400;
    delete accepts[2]!['maxTimeoutSeconds'];
    pr['resource'] = { url: '/relative' };
    const v = validatePaymentRequired(pr);
    expect(v.findings.filter((f) => f.id === 'pr.accept.timeout').map((f) => f.severity)).toEqual(['warn', 'warn', 'error']);
    expect(ids(v)).toEqual(expect.arrayContaining(['pr.resource.url', 'pr.resource.description', 'pr.resource.mime-type']));
  });

  it('warns on an unknown scheme', () => {
    const pr = clone(goodPaymentRequired());
    pr.accepts[0]!.scheme = 'upto';
    expect(ids(validatePaymentRequired(pr), 'warn')).toContain('pr.accept.scheme');
  });
});
