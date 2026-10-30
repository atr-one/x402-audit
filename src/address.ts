import { keccak_256 } from '@noble/hashes/sha3';

const HEX_ADDRESS = /^0x[0-9a-fA-F]{40}$/;

/** True for `0x` followed by 40 hex digits, in any case. */
export function isEvmAddress(value: unknown): value is string {
  return typeof value === 'string' && HEX_ADDRESS.test(value);
}

/** EIP-55 mixed-case checksum encoding of an EVM address. Throws on a malformed address. */
export function toChecksumAddress(address: string): string {
  if (!isEvmAddress(address)) throw new Error(`not an EVM address: ${address}`);
  const lower = address.slice(2).toLowerCase();
  const hash = keccak_256(new TextEncoder().encode(lower));
  let out = '0x';
  for (let i = 0; i < 40; i++) {
    const ch = lower[i] as string;
    // nibble i of the hash: high nibble of byte i/2 for even i, low nibble for odd i
    const byte = hash[i >> 1] as number;
    const nibble = i % 2 === 0 ? byte >> 4 : byte & 0x0f;
    out += nibble >= 8 ? ch.toUpperCase() : ch;
  }
  return out;
}

export type ChecksumState = 'valid' | 'unchecksummed' | 'invalid' | 'malformed';

/**
 * Classify an EVM address:
 * - `valid`: matches its EIP-55 checksum
 * - `unchecksummed`: all lower or all upper case hex that is not the checksum form (accepted by most code, but
 *   case-sensitive lookups such as facilitator discovery by payTo will miss it)
 * - `invalid`: mixed case that does not match the checksum (likely a typo)
 * - `malformed`: not 0x + 40 hex digits
 */
export function checksumState(address: unknown): ChecksumState {
  if (!isEvmAddress(address)) return 'malformed';
  const sum = toChecksumAddress(address);
  if (sum === address) return 'valid';
  const body = address.slice(2);
  if (body === body.toLowerCase() || body === body.toUpperCase()) return 'unchecksummed';
  return 'invalid';
}

const B58_ALPHABET = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
const B58_MAP: Record<string, number> = Object.fromEntries([...B58_ALPHABET].map((c, i) => [c, i]));

/** Decode a base58 (Bitcoin alphabet) string. Returns null on an invalid character. */
export function base58Decode(value: string): Uint8Array | null {
  if (value.length === 0) return new Uint8Array(0);
  let n = 0n;
  for (const c of value) {
    const digit = B58_MAP[c];
    if (digit === undefined) return null;
    n = n * 58n + BigInt(digit);
  }
  const bytes: number[] = [];
  while (n > 0n) {
    bytes.push(Number(n & 0xffn));
    n >>= 8n;
  }
  for (const c of value) {
    if (c !== '1') break;
    bytes.push(0);
  }
  return Uint8Array.from(bytes.reverse());
}

/** A Solana address (public key or mint) is base58 of exactly 32 bytes. */
export function isSolanaAddress(value: unknown): value is string {
  if (typeof value !== 'string' || value.length < 32 || value.length > 44) return false;
  const bytes = base58Decode(value);
  return bytes !== null && bytes.length === 32;
}
