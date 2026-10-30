import { describe, expect, it } from 'vitest';
import { checkPrice } from '../src/checks/price.js';
import { formatUnits, parseDocumentedPrice, parseUnits, parseUsd, priceMatches, usdPrice } from '../src/price.js';
import { clone, goodPaymentRequired, USDC_BASE } from './fixtures.js';

describe('units', () => {
  it('formats atomic units exactly', () => {
    expect(formatUnits('10000', 6)).toBe('0.01');
    expect(formatUnits('1', 6)).toBe('0.000001');
    expect(formatUnits('1000000', 6)).toBe('1');
    expect(formatUnits('1234567', 6)).toBe('1.234567');
    expect(formatUnits('0', 6)).toBe('0');
    expect(formatUnits('250000', 6)).toBe('0.25');
    expect(formatUnits('123456789012345678901234567890', 18)).toBe('123456789012.34567890123456789');
    expect(formatUnits('42', 0)).toBe('42');
    expect(() => formatUnits('0.5', 6)).toThrow();
  });

  it('parses decimals into atomic units', () => {
    expect(parseUnits('0.01', 6)).toBe('10000');
    expect(parseUnits('1', 6)).toBe('1000000');
    expect(parseUnits('.5', 6)).toBe('500000');
    expect(parseUnits('0.0000001', 6)).toBeNull();
    expect(parseUnits('abc', 6)).toBeNull();
  });

  it('prices known USDC offers in USD', () => {
    expect(usdPrice({ network: 'eip155:8453', asset: USDC_BASE, amount: '10000' })).toBe(0.01);
    expect(usdPrice({ network: 'eip155:8453', asset: USDC_BASE.toLowerCase(), amount: '2500' })).toBe(0.0025);
    expect(usdPrice({ network: 'eip155:8453', asset: '0x0000000000000000000000000000000000000001', amount: '10000' })).toBeUndefined();
    expect(usdPrice({ network: 'eip155:8453', asset: USDC_BASE, amount: '0.01' })).toBeUndefined();
  });
});

describe('documented prices', () => {
  it('reads the x-payment-info shapes', () => {
    expect(parseDocumentedPrice({ mode: 'fixed', currency: 'USD', amount: '0.01' })).toEqual({ mode: 'fixed', amount: 0.01 });
    expect(parseDocumentedPrice({ mode: 'dynamic', currency: 'USD', min: '0.01', max: '0.5' })).toEqual({ mode: 'dynamic', min: 0.01, max: 0.5 });
    expect(parseDocumentedPrice('$0.02')).toEqual({ mode: 'fixed', amount: 0.02 });
    expect(parseDocumentedPrice(0.03)).toEqual({ mode: 'fixed', amount: 0.03 });
    expect(parseDocumentedPrice({ amount: '0.04' })).toEqual({ mode: 'fixed', amount: 0.04 });
    expect(parseDocumentedPrice({ mode: 'fixed', currency: 'EUR', amount: '0.01' })).toBeUndefined();
    expect(parseDocumentedPrice({ mode: 'dynamic', min: '1', max: '0.5' })).toBeUndefined();
    expect(parseDocumentedPrice('ten cents')).toBeUndefined();
    expect(parseUsd('0.01 USDC')).toBe(0.01);
  });

  it('matches fixed and dynamic prices', () => {
    expect(priceMatches(0.01, { mode: 'fixed', amount: 0.01 })).toBe(true);
    expect(priceMatches(0.1 + 0.2, { mode: 'fixed', amount: 0.3 })).toBe(true);
    expect(priceMatches(0.02, { mode: 'fixed', amount: 0.01 })).toBe(false);
    expect(priceMatches(0.05, { mode: 'dynamic', min: 0.01, max: 0.1 })).toBe(true);
    expect(priceMatches(0.25, { mode: 'dynamic', min: 0.01, max: 0.1 })).toBe(false);
  });
});

describe('checkPrice', () => {
  it('passes a consistent price', () => {
    expect(checkPrice(goodPaymentRequired(), { mode: 'fixed', amount: 0.01 }, 10)).toEqual([]);
  });

  it('warns when the cheapest offer misses the documented price, and notes other networks', () => {
    const pr = clone(goodPaymentRequired());
    pr.accepts[1]!.amount = '250000'; // Ethereum floor $0.25
    const f = checkPrice(pr, { mode: 'dynamic', min: 0.01, max: 0.1 }, 10);
    expect(f.map((x) => x.id)).toEqual(['price.network-differs']);
    const g = checkPrice(pr, { mode: 'fixed', amount: 0.02 }, 10);
    expect(g.map((x) => x.id)).toEqual(['price.mismatch', 'price.network-differs']);
  });

  it('warns on prices out of bounds', () => {
    const pr = clone(goodPaymentRequired());
    pr.accepts[0]!.amount = '1'; // $0.000001
    pr.accepts[1]!.amount = '20000000'; // $20
    const ids = checkPrice(pr, undefined, 10).map((x) => x.id);
    expect(ids).toEqual(['price.too-low', 'price.too-high']);
  });

  it('notes assets it cannot price', () => {
    const pr = clone(goodPaymentRequired());
    pr.accepts[0]!.asset = '0x0000000000000000000000000000000000000001';
    expect(checkPrice(pr, undefined, 10).map((x) => x.id)).toEqual(['price.unknown-asset']);
  });
});
