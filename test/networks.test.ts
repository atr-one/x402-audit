import { describe, expect, it } from 'vitest';
import { checksumState, isSolanaAddress } from '../src/address.js';
import { knownToken, NETWORK_ALIASES, NETWORKS, networkFamily, onNetworks, parseCaip2, resolveNetwork, V1_NAMES } from '../src/networks.js';

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

  it('matches the USDC table checked on 2026-10-30 (Circle contract list; EIP-712 name read on-chain)', () => {
    // https://developers.circle.com/stablecoins/usdc-contract-addresses, addresses copied verbatim
    const verified: Record<string, [address: string, eip712Name?: string]> = {
      'eip155:8453': ['0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913', 'USD Coin'],
      'eip155:84532': ['0x036CbD53842c5426634e7929541eC2318f3dCF7e', 'USDC'],
      'eip155:1': ['0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48', 'USD Coin'],
      'eip155:11155111': ['0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238', 'USDC'],
      'eip155:137': ['0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359', 'USD Coin'],
      'eip155:80002': ['0x41E94Eb019C0762f9Bfcf9Fb1E58725BfB0e7582', 'USDC'],
      'eip155:42161': ['0xaf88d065e77c8cC2239327C5EDb3A432268e5831', 'USD Coin'],
      'eip155:421614': ['0x75faf114eafb1BDbe2F0316DF893fd58CE46AA4d', 'USD Coin'],
      'eip155:10': ['0x0b2C639c533813f4Aa9D7837CAf62653d097Ff85', 'USD Coin'],
      'eip155:11155420': ['0x5fd84259d66Cd46123540766Be93DFE6D43130D7', 'USDC'],
      'eip155:43114': ['0xB97EF9Ef8734C71904D8002F8b6Bc66Dd9c48a6E', 'USD Coin'],
      'eip155:43113': ['0x5425890298aed601595a70AB815c96711a31Bc65', 'USD Coin'],
      'solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp': ['EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v'],
      'solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1': ['4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU']
    };
    const withUsdc = Object.values(NETWORKS).filter((n) => n.usdc);
    expect(withUsdc.map((n) => n.id).sort()).toEqual(Object.keys(verified).sort());
    for (const n of withUsdc) {
      const [address, name] = verified[n.id]!;
      expect(n.usdc?.address, n.name).toBe(address);
      expect(n.usdc?.eip712?.name, n.name).toBe(name);
      expect(n.usdc?.confidence, n.name).toBe('high');
    }
  });

  it('maps v1 names and finds tokens case-insensitively on EVM', () => {
    expect(V1_NAMES['base']).toBe('eip155:8453');
    expect(V1_NAMES['solana']).toBe('solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp');
    expect(knownToken('eip155:8453', '0x833589fcd6edb6e08f4c7c32d4f71b54bda02913')?.symbol).toBe('USDC');
    expect(knownToken('eip155:1', '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913')).toBeUndefined();
    expect(knownToken('solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp', 'epjfwdd5aufqssqem2qn1xzybapc8g4wegggzwytdt1v')).toBeUndefined();
  });
});

describe('network aliases', () => {
  const SOL = 'solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp';

  it('resolves names, v1 names and common short names to CAIP-2', () => {
    const cases: Record<string, string> = {
      base: 'eip155:8453',
      'base-sepolia': 'eip155:84532',
      ethereum: 'eip155:1',
      'ethereum-sepolia': 'eip155:11155111',
      sepolia: 'eip155:11155111',
      polygon: 'eip155:137',
      'polygon-pos': 'eip155:137',
      'polygon-amoy': 'eip155:80002',
      arbitrum: 'eip155:42161',
      'arbitrum-one': 'eip155:42161',
      'arbitrum-sepolia': 'eip155:421614',
      op: 'eip155:10',
      optimism: 'eip155:10',
      'op-mainnet': 'eip155:10',
      'op-sepolia': 'eip155:11155420',
      'optimism-sepolia': 'eip155:11155420',
      avalanche: 'eip155:43114',
      'avalanche-c-chain': 'eip155:43114',
      'avalanche-fuji': 'eip155:43113',
      solana: SOL,
      'solana-mainnet': SOL,
      'solana-devnet': 'solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1'
    };
    for (const [alias, id] of Object.entries(cases)) expect(resolveNetwork(alias), alias).toBe(id);
  });

  it('ignores case and surrounding spaces in aliases', () => {
    expect(resolveNetwork('Base')).toBe('eip155:8453');
    expect(resolveNetwork(' BASE-SEPOLIA ')).toBe('eip155:84532');
  });

  it('takes CAIP-2 ids as they are, also outside the table, and lowercases only the namespace', () => {
    expect(resolveNetwork('eip155:8453')).toBe('eip155:8453');
    expect(resolveNetwork('EIP155:8453')).toBe('eip155:8453');
    expect(resolveNetwork('eip155:999999')).toBe('eip155:999999');
    expect(resolveNetwork(SOL)).toBe(SOL);
    expect(resolveNetwork('SOLANA:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp')).toBe(SOL);
  });

  it('refuses what is neither an alias nor CAIP-2', () => {
    for (const bad of ['', '  ', 'nope', 'bsc', '8453', 'eip155:', 'toString', 'constructor']) expect(resolveNetwork(bad), bad).toBeUndefined();
  });

  it('every alias points at a network in the table', () => {
    for (const [alias, id] of Object.entries(NETWORK_ALIASES)) {
      expect(NETWORKS[id], alias).toBeDefined();
      expect(alias).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/);
    }
  });

  it('selects offers by CAIP-2 id, counting a v1 name as its network', () => {
    const base = new Set(['eip155:8453']);
    expect(onNetworks('eip155:8453', base)).toBe(true);
    expect(onNetworks('base', base)).toBe(true);
    expect(onNetworks('eip155:1', base)).toBe(false);
    expect(onNetworks('ethereum', base)).toBe(false);
    expect(onNetworks(undefined, base)).toBe(false);
    expect(onNetworks('toString', base)).toBe(false);
    expect(onNetworks('anything', undefined)).toBe(true);
  });
});
