/**
 * CAIP-2 network identifiers and a small table of canonical USDC deployments.
 *
 * x402 v2 names networks by CAIP-2 (`namespace:reference`): `eip155:<chainId>` for EVM chains and
 * `solana:<first 32 chars of the genesis hash>` for Solana clusters. v1 used short names such as `base`.
 *
 * The USDC table is used to flag an `asset` that is not the canonical USDC of its network and to know the token's
 * decimals and EIP-712 domain. `confidence: 'high'` entries were checked against the issuer's published contract list;
 * `'medium'` entries are believed correct but not verified, so a mismatch against them is reported as info rather
 * than a warning. To extend the table, add an entry to NETWORKS (see README, "Networks and the USDC table").
 *
 * USDC table checked on 2026-10-30:
 * - Every address (EVM and Solana) matches Circle's list character for character:
 *   https://developers.circle.com/stablecoins/usdc-contract-addresses
 * - Circle's list does not give the EIP-712 domain. For every EVM entry, `name()`, `version()` and `decimals()` were
 *   read from the contract itself (eth_call on a public RPC endpoint, chain id checked); USDC (FiatToken v2) builds its
 *   EIP-712 domain from `name()` and version "2". Mainnets answer "USD Coin"; Base Sepolia, Ethereum Sepolia,
 *   Polygon Amoy and OP Sepolia answer "USDC"; Arbitrum Sepolia and Avalanche Fuji answer "USD Coin".
 */

export interface Caip2 {
  namespace: string;
  reference: string;
}

const CAIP2 = /^([-a-z0-9]{3,8}):([-_a-zA-Z0-9]{1,32})$/;

/** Parse a CAIP-2 chain id. Returns null when the string is not CAIP-2. */
export function parseCaip2(value: unknown): Caip2 | null {
  if (typeof value !== 'string') return null;
  const m = CAIP2.exec(value);
  if (!m) return null;
  return { namespace: m[1] as string, reference: m[2] as string };
}

export type Family = 'evm' | 'svm' | 'other';

export function networkFamily(network: string): Family {
  const p = parseCaip2(network);
  if (!p) return 'other';
  if (p.namespace === 'eip155') return 'evm';
  if (p.namespace === 'solana') return 'svm';
  return 'other';
}

export interface TokenInfo {
  symbol: string;
  address: string;
  decimals: number;
  /** EIP-712 domain the token's `transferWithAuthorization` is signed under (EVM only). */
  eip712?: { name: string; version: string };
  confidence: 'high' | 'medium';
}

export interface NetworkInfo {
  id: string;
  name: string;
  testnet: boolean;
  /** v1 short name, when x402 v1 had one. */
  v1Name?: string;
  usdc?: TokenInfo;
}

const usdcEvm = (address: string, name: string, confidence: TokenInfo['confidence'] = 'high'): TokenInfo => ({
  symbol: 'USDC',
  address,
  decimals: 6,
  eip712: { name, version: '2' },
  confidence
});

export const NETWORKS: Record<string, NetworkInfo> = {
  'eip155:8453': { id: 'eip155:8453', name: 'Base', testnet: false, v1Name: 'base', usdc: usdcEvm('0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913', 'USD Coin') },
  'eip155:84532': { id: 'eip155:84532', name: 'Base Sepolia', testnet: true, v1Name: 'base-sepolia', usdc: usdcEvm('0x036CbD53842c5426634e7929541eC2318f3dCF7e', 'USDC') },
  'eip155:1': { id: 'eip155:1', name: 'Ethereum', testnet: false, v1Name: 'ethereum', usdc: usdcEvm('0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48', 'USD Coin') },
  'eip155:11155111': { id: 'eip155:11155111', name: 'Ethereum Sepolia', testnet: true, v1Name: 'sepolia', usdc: usdcEvm('0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238', 'USDC') },
  'eip155:137': { id: 'eip155:137', name: 'Polygon', testnet: false, v1Name: 'polygon', usdc: usdcEvm('0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359', 'USD Coin') },
  'eip155:80002': { id: 'eip155:80002', name: 'Polygon Amoy', testnet: true, v1Name: 'polygon-amoy', usdc: usdcEvm('0x41E94Eb019C0762f9Bfcf9Fb1E58725BfB0e7582', 'USDC') },
  'eip155:42161': { id: 'eip155:42161', name: 'Arbitrum One', testnet: false, v1Name: 'arbitrum', usdc: usdcEvm('0xaf88d065e77c8cC2239327C5EDb3A432268e5831', 'USD Coin') },
  'eip155:421614': { id: 'eip155:421614', name: 'Arbitrum Sepolia', testnet: true, v1Name: 'arbitrum-sepolia', usdc: usdcEvm('0x75faf114eafb1BDbe2F0316DF893fd58CE46AA4d', 'USD Coin') },
  'eip155:10': { id: 'eip155:10', name: 'OP Mainnet', testnet: false, v1Name: 'optimism', usdc: usdcEvm('0x0b2C639c533813f4Aa9D7837CAf62653d097Ff85', 'USD Coin') },
  'eip155:11155420': { id: 'eip155:11155420', name: 'OP Sepolia', testnet: true, v1Name: 'optimism-sepolia', usdc: usdcEvm('0x5fd84259d66Cd46123540766Be93DFE6D43130D7', 'USDC') },
  'eip155:43114': { id: 'eip155:43114', name: 'Avalanche C-Chain', testnet: false, v1Name: 'avalanche', usdc: usdcEvm('0xB97EF9Ef8734C71904D8002F8b6Bc66Dd9c48a6E', 'USD Coin') },
  'eip155:43113': { id: 'eip155:43113', name: 'Avalanche Fuji', testnet: true, v1Name: 'avalanche-fuji', usdc: usdcEvm('0x5425890298aed601595a70AB815c96711a31Bc65', 'USD Coin') },
  'solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp': {
    id: 'solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp',
    name: 'Solana',
    testnet: false,
    v1Name: 'solana',
    usdc: { symbol: 'USDC', address: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v', decimals: 6, confidence: 'high' }
  },
  'solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1': {
    id: 'solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1',
    name: 'Solana Devnet',
    testnet: true,
    v1Name: 'solana-devnet',
    usdc: { symbol: 'USDC', address: '4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU', decimals: 6, confidence: 'high' }
  }
};

/** v1 short network name -> CAIP-2 id, for fix hints. */
export const V1_NAMES: Record<string, string> = Object.fromEntries(
  Object.values(NETWORKS)
    .filter((n) => n.v1Name)
    .map((n) => [n.v1Name as string, n.id])
);

export function networkInfo(network: string): NetworkInfo | undefined {
  return NETWORKS[network];
}

export function networkLabel(network: string): string {
  const n = NETWORKS[network];
  return n ? `${n.name} (${network})` : network;
}

/** The token at `asset` on `network`, when it is in the table. EVM addresses compare case-insensitively. */
export function knownToken(network: string, asset: string): TokenInfo | undefined {
  const usdc = NETWORKS[network]?.usdc;
  if (!usdc) return undefined;
  const same = networkFamily(network) === 'evm' ? usdc.address.toLowerCase() === asset.toLowerCase() : usdc.address === asset;
  return same ? usdc : undefined;
}

const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');

/**
 * Short names accepted for a network (`--network base`): each table name in lowercase with dashes (`base-sepolia`,
 * `op-mainnet`, `avalanche-c-chain`), each v1 name (`ethereum`, `sepolia`, `optimism`, `solana-devnet`) and a few
 * common ones (`op`, `polygon-pos`, `solana-mainnet`).
 */
export const NETWORK_ALIASES: Readonly<Record<string, string>> = Object.freeze({
  ...Object.fromEntries(Object.values(NETWORKS).flatMap((n) => [[slug(n.name), n.id], ...(n.v1Name ? [[n.v1Name, n.id]] : [])])),
  op: 'eip155:10',
  'polygon-pos': 'eip155:137',
  'solana-mainnet': 'solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp'
});

/**
 * A network given by a person (`base`, `Base-Sepolia`, `eip155:8453`, `solana:5eykt4...`) -> its CAIP-2 id. Aliases are
 * case-insensitive; any valid CAIP-2 id is accepted as is, also one outside the table. Undefined when it is neither.
 */
export function resolveNetwork(input: string): string | undefined {
  const s = input.trim();
  const key = s.toLowerCase();
  if (Object.hasOwn(NETWORK_ALIASES, key)) return NETWORK_ALIASES[key];
  const colon = s.indexOf(':');
  const caip = colon > 0 ? s.slice(0, colon).toLowerCase() + s.slice(colon) : s;
  return parseCaip2(caip) ? caip : undefined;
}

/**
 * Whether an offer's `network` is one of `selected` (CAIP-2 ids). A v1 name counts as the network it names, so a
 * broken `"network": "base"` offer is still audited under `--network base`. No selection selects every offer.
 */
export function onNetworks(network: unknown, selected?: ReadonlySet<string>): boolean {
  if (!selected) return true;
  if (typeof network !== 'string') return false;
  return selected.has(Object.hasOwn(V1_NAMES, network) ? (V1_NAMES[network] as string) : network);
}
