import { describe, expect, it } from 'vitest';
import { base58Decode, checksumState, isEvmAddress, isSolanaAddress, toChecksumAddress } from '../src/address.js';

// the test vectors of EIP-55 (https://eips.ethereum.org/EIPS/eip-55#test-cases)
const EIP55_VECTORS = [
  // all caps
  '0x52908400098527886E0F7030069857D2E4169EE7',
  '0x8617E340B3D01FA5F11F306F4090FD50E238070D',
  // all lower
  '0xde709f2102306220921060314715629080e2fb77',
  '0x27b1fdb04752bbc536007a920d24acb045561c26',
  // normal
  '0x5aAeb6053F3E94C9b9A09f33669435E7Ef1BeAed',
  '0xfB6916095ca1df60bB79Ce92cE3Ea74c37c5d359',
  '0xdbF03B407c01E7cD3CBea99509d93f8DDDC8C6FB',
  '0xD1220A0cf47c7B9Be7A2E6BA89F429762e7b9aDb'
];

describe('EIP-55', () => {
  it.each(EIP55_VECTORS)('checksums %s', (vector) => {
    expect(toChecksumAddress(vector.toLowerCase())).toBe(vector);
    expect(toChecksumAddress('0x' + vector.slice(2).toUpperCase())).toBe(vector);
    expect(checksumState(vector)).toBe('valid');
  });

  it('classifies unchecksummed, invalid and malformed addresses', () => {
    expect(checksumState('0x5aaeb6053f3e94c9b9a09f33669435e7ef1beaed')).toBe('unchecksummed');
    expect(checksumState('0x5AAEB6053F3E94C9B9A09F33669435E7EF1BEAED')).toBe('unchecksummed');
    // one letter's case flipped
    expect(checksumState('0x5AAeb6053F3E94C9b9A09f33669435E7Ef1BeAed')).toBe('invalid');
    expect(checksumState('0x5aAeb6053F3E94C9b9A09f33669435E7Ef1BeAe')).toBe('malformed');
    expect(checksumState('5aAeb6053F3E94C9b9A09f33669435E7Ef1BeAed')).toBe('malformed');
    expect(checksumState(42)).toBe('malformed');
  });

  it('rejects non-addresses', () => {
    expect(isEvmAddress('0xZZ')).toBe(false);
    expect(() => toChecksumAddress('0x123')).toThrow();
  });
});

describe('base58 / Solana', () => {
  it('decodes known values', () => {
    expect(Array.from(base58Decode('') ?? [])).toEqual([]);
    expect(Array.from(base58Decode('1') ?? [])).toEqual([0]);
    expect(Array.from(base58Decode('2g') ?? [])).toEqual([0x61]); // "a"
    expect(Buffer.from(base58Decode('StV1DL6CwTryKyV') ?? []).toString()).toBe('hello world');
    expect(base58Decode('0OIl')).toBeNull();
  });

  it('accepts 32-byte keys only', () => {
    expect(isSolanaAddress('EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v')).toBe(true);
    expect(isSolanaAddress('11111111111111111111111111111111')).toBe(true);
    expect(isSolanaAddress('EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyT')).toBe(false); // 30 bytes
    expect(isSolanaAddress('0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913')).toBe(false);
    expect(isSolanaAddress('EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1l')).toBe(false); // "l" is not base58
  });
});
