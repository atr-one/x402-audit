import { describe, expect, it } from 'vitest';
import { checksumState, isSolanaAddress } from '../src/address.js';
import { knownToken, NETWORKS, networkFamily, parseCaip2, V1_NAMES } from '../src/networks.js';

describe('CAIP-2', () => {
  it('parses valid chain ids', () => {
    expect(parseCaip2('eip155:8453')).toEqual({ namespace: 'eip155', reference: '8453' });
    expect(parseCaip2('solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp')).toEqual({ namespace: 'solana', reference: '5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp' });
    expect(parseCaip2('cosmos:cosmoshub-3')).toEqual({ namespace: 'cosmos', reference: 'cosmoshub-3' });
  });

  it('rejects malformed ids', () => {
    for (const bad of ['base', 'eip155', 'eip155:', ':8453', 'EIP155:1', 'ab:1', 'toolongns:1', 'eip155:1:2', 'solana:' + 'x'.repeat(33), 'eip155:84 53', 8453, null]) {
      expect(parseCaip2(bad), String(bad)).toBeNull();
    }
  });

  it('knows the families', () => {
    expect(networkFamily('eip155:1')).toBe('evm');
    expect(networkFamily('solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1')).toBe('svm');
    expect(networkFamily('cosmos:cosmoshub-3')).toBe('other');
    expect(networkFamily('base')).toBe('other');
  });
});

describe('network table', () => {
  it('every key is valid CAIP-2 and matches its id', () => {
    for (const [key, n] of Object.entries(NETWORKS)) {
      expect(parseCaip2(key), key).not.toBeNull();
      expect(n.id).toBe(key);
    }
  });

  it('every EVM USDC address carries a valid EIP-55 checksum (catches typos in the table)', () => {
    for (const n of Object.values(NETWORKS)) {
      if (!n.usdc || networkFamily(n.id) !== 'evm') continue;
      expect(checksumState(n.usdc.address), n.name).toBe('valid');
      expect(n.usdc.decimals).toBe(6);
      expect(n.usdc.eip712?.version).toBe('2');
    }
  });

  it('every Solana USDC mint is a 32-byte key', () => {
    for (const n of Object.values(NETWORKS)) if (n.usdc && networkFamily(n.id) === 'svm') expect(isSolanaAddress(n.usdc.address), n.name).toBe(true);
  });

  it('covers the required networks', () => {
    for (const id of ['eip155:8453', 'eip155:84532', 'eip155:1', 'eip155:137', 'eip155:42161', 'eip155:10', 'eip155:43114', 'solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp', 'solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1'])
      expect(NETWORKS[id]?.usdc, id).toBeDefined();
  });

  it('maps v1 names and finds tokens case-insensitively on EVM', () => {
    expect(V1_NAMES['base']).toBe('eip155:8453');
    expect(V1_NAMES['solana']).toBe('solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp');
    expect(knownToken('eip155:8453', '0x833589fcd6edb6e08f4c7c32d4f71b54bda02913')?.symbol).toBe('USDC');
    expect(knownToken('eip155:1', '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913')).toBeUndefined();
    expect(knownToken('solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp', 'epjfwdd5aufqssqem2qn1xzybapc8g4wegggzwytdt1v')).toBeUndefined();
  });
});
