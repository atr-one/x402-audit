/**
 * Decode and validate an x402 v2 PaymentRequired object (the `PAYMENT-REQUIRED` response header of a 402).
 * Both functions are pure and usable on their own.
 */
import { checksumState, isSolanaAddress } from './address.js';
import { NETWORKS, V1_NAMES, networkFamily, networkLabel, onNetworks, parseCaip2 } from './networks.js';
import type { Finding, PaymentRequired, Severity } from './types.js';

export type DecodeResult =
  | { ok: true; value: unknown; json: string; encoding: 'base64' | 'base64url' }
  | { ok: false; error: string; plainJson?: unknown };

const B64 = /^[A-Za-z0-9+/]+={0,2}$/;
const B64URL = /^[A-Za-z0-9_-]+={0,2}$/;

/**
 * Decode a `PAYMENT-REQUIRED` header value: base64 of UTF-8 JSON. A base64url value is decoded too (and reported as
 * such through `encoding`); a header that is plain JSON is refused with `plainJson` set, so callers can say what is wrong.
 */
export function decodePaymentRequired(header: string): DecodeResult {
  const value = header.trim();
  if (value === '') return { ok: false, error: 'the header is empty' };
  if (value.startsWith('{')) {
    let plainJson: unknown;
    try {
      plainJson = JSON.parse(value);
    } catch {
      /* not JSON either */
    }
    return { ok: false, error: 'the header is plain JSON, not base64-encoded JSON', plainJson };
  }
  let encoding: 'base64' | 'base64url';
  if (B64.test(value)) encoding = 'base64';
  else if (B64URL.test(value)) encoding = 'base64url';
  else return { ok: false, error: 'the header is not base64 (unexpected characters)' };
  const json = Buffer.from(value, encoding).toString('utf8');
  try {
    return { ok: true, value: JSON.parse(json), json, encoding };
  } catch {
    return { ok: false, error: 'the base64 payload is not valid JSON' };
  }
}

export interface ValidationResult {
  /** True when there is no `error` finding. */
  valid: boolean;
  findings: Finding[];
  /** The input typed as PaymentRequired when it has the basic shape (object with an accepts array). */
  value?: PaymentRequired;
}

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const ATOMIC = /^(0|[1-9][0-9]*)$/;
const ZERO_EVM = /^0x0{40}$/i;

export interface ValidateOptions {
  /**
   * Validate only the `accepts` entries on these CAIP-2 networks (a v1 name counts as the network it names). Messages
   * keep the original `accepts[i]` index. Default: every entry.
   */
  networks?: Iterable<string>;
}

/** Validate a decoded PaymentRequired object against x402 v2. */
export function validatePaymentRequired(input: unknown, options: ValidateOptions = {}): ValidationResult {
  const findings: Finding[] = [];
  const add = (id: string, severity: Severity, message: string, fix?: string) => findings.push(fix ? { id, severity, message, fix } : { id, severity, message });

  if (!isObject(input)) {
    add('pr.shape', 'error', 'PaymentRequired is not a JSON object.', 'Send base64(JSON.stringify({x402Version: 2, resource, accepts})).');
    return { valid: false, findings };
  }

  // version
  const version = input['x402Version'];
  if (version === undefined) add('pr.version', 'error', 'x402Version is missing.', 'Set "x402Version": 2.');
  else if (version === 1) add('pr.version', 'error', 'x402Version is 1; current clients speak v2 (PAYMENT-REQUIRED header, CAIP-2 networks, "amount").', 'Upgrade to x402 v2: "x402Version": 2, CAIP-2 networks, "amount" instead of "maxAmountRequired".');
  else if (version !== 2) add('pr.version', 'error', `x402Version is ${JSON.stringify(version)}, expected 2.`, 'Set "x402Version": 2 (a number).');

  if ('error' in input && typeof input['error'] !== 'string') add('pr.error-field', 'warn', '"error" is present but not a string.', 'Make "error" a human-readable string or drop it.');

  // resource
  const resource = input['resource'];
  if (resource === undefined) add('pr.resource', 'error', 'resource is missing.', 'Add "resource": {"url", "description", "mimeType"}.');
  else if (typeof resource === 'string') add('pr.resource', 'error', 'resource is a string (v1 shape); v2 expects an object.', 'Use "resource": {"url": "...", "description": "...", "mimeType": "application/json"}.');
  else if (!isObject(resource)) add('pr.resource', 'error', 'resource is not an object.');
  else {
    const url = resource['url'];
    if (typeof url !== 'string' || url === '') add('pr.resource.url', 'error', 'resource.url is missing.', 'Set resource.url to the absolute URL of the paid endpoint.');
    else if (!/^https?:\/\//i.test(url)) add('pr.resource.url', 'error', `resource.url is not an absolute http(s) URL: ${url}`);
    if (typeof resource['description'] !== 'string' || resource['description'].trim() === '')
      add('pr.resource.description', 'warn', 'resource.description is missing or empty; directories and agents show it to decide whether to pay.', 'Describe what one paid call returns in a sentence.');
    if (typeof resource['mimeType'] !== 'string' || resource['mimeType'] === '')
      add('pr.resource.mime-type', 'warn', 'resource.mimeType is missing.', 'Set resource.mimeType, e.g. "application/json".');
  }

  // accepts
  const accepts = input['accepts'];
  if (!Array.isArray(accepts)) {
    add('pr.accepts', 'error', 'accepts is missing or not an array.', 'List at least one payment option in "accepts".');
    return { valid: false, findings };
  }
  if (accepts.length === 0) add('pr.accepts', 'error', 'accepts is empty: nothing can be paid.', 'List at least one payment option in "accepts".');
  const selected = options.networks ? new Set(options.networks) : undefined;
  accepts.forEach((a, i) => {
    if (onNetworks(isObject(a) ? a['network'] : undefined, selected)) validateAccept(a, i, add);
  });

  // extensions
  if ('extensions' in input && !isObject(input['extensions'])) add('pr.extensions', 'warn', 'extensions is present but not an object.');

  const valid = !findings.some((f) => f.severity === 'error');
  return { valid, findings, value: input as unknown as PaymentRequired };
}

type Add = (id: string, severity: Severity, message: string, fix?: string) => void;

function validateAccept(a: unknown, i: number, add: Add): void {
  const at = `accepts[${i}]`;
  if (!isObject(a)) {
    add('pr.accept.shape', 'error', `${at} is not an object.`);
    return;
  }

  // scheme
  const scheme = a['scheme'];
  if (typeof scheme !== 'string' || scheme === '') add('pr.accept.scheme', 'error', `${at}.scheme is missing.`, 'Set "scheme": "exact".');
  else if (scheme !== 'exact') add('pr.accept.scheme', 'warn', `${at}.scheme "${scheme}" is not "exact"; most clients only implement "exact".`, 'Offer an "exact" option alongside it.');

  // network
  const network = a['network'];
  let family: ReturnType<typeof networkFamily> = 'other';
  if (typeof network !== 'string' || network === '') add('pr.accept.network', 'error', `${at}.network is missing.`);
  else if (V1_NAMES[network]) add('pr.accept.network', 'error', `${at}.network "${network}" is a v1 name; v2 uses CAIP-2.`, `Use "${V1_NAMES[network]}".`);
  else if (!parseCaip2(network)) add('pr.accept.network', 'error', `${at}.network "${network}" is not a CAIP-2 chain id.`, 'Use e.g. "eip155:8453" (Base) or "solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp" (Solana).');
  else {
    family = networkFamily(network);
    if (!NETWORKS[network]) add('pr.accept.network-unknown', 'info', `${at}.network ${network} is valid CAIP-2 but not in the built-in table; asset and price checks are limited.`);
  }
  const known = typeof network === 'string' ? NETWORKS[network] : undefined;

  // amount
  const amount = a['amount'];
  if (amount === undefined) {
    if ('maxAmountRequired' in a) add('pr.accept.amount', 'error', `${at} has "maxAmountRequired" (v1) and no "amount".`, 'Rename it to "amount" (v2).');
    else add('pr.accept.amount', 'error', `${at}.amount is missing.`, 'Set "amount" to the price in atomic units as a string, e.g. "10000" for $0.01 USDC.');
  } else if (typeof amount !== 'string') add('pr.accept.amount', 'error', `${at}.amount is a ${typeof amount}; it must be a string of atomic units.`, `Send "amount": "${String(amount)}".`);
  else if (!ATOMIC.test(amount)) {
    const fix = /^\d*\.\d+$/.test(amount) ? 'Amounts are atomic units (integer), not dollars: $0.01 USDC is "10000".' : 'Use a base-10 integer string without sign, spaces or leading zeros.';
    add('pr.accept.amount', 'error', `${at}.amount "${amount}" is not an integer string of atomic units.`, fix);
  } else if (amount === '0') add('pr.accept.amount', 'error', `${at}.amount is 0.`);

  // asset
  const asset = a['asset'];
  if (typeof asset !== 'string' || asset === '') add('pr.accept.asset', 'error', `${at}.asset is missing.`, 'Set "asset" to the token contract (EVM) or mint (Solana).');
  else if (family === 'evm') {
    const state = checksumState(asset);
    if (state === 'malformed') add('pr.accept.asset', 'error', `${at}.asset "${asset}" is not an EVM address.`);
    else if (state === 'invalid') add('pr.accept.asset', 'error', `${at}.asset ${asset} has a wrong EIP-55 checksum (mixed case that does not match).`, 'Copy the address again from the token issuer.');
    else if (state === 'unchecksummed') add('pr.accept.asset-checksum', 'warn', `${at}.asset ${asset} is not in EIP-55 checksum form.`, 'Use the checksummed address.');
    if (state !== 'malformed' && known?.usdc && known.usdc.address.toLowerCase() !== asset.toLowerCase())
      add('pr.accept.asset-unknown', known.usdc.confidence === 'high' ? 'warn' : 'info', `${at}.asset ${asset} is not the canonical USDC on ${networkLabel(network as string)} (${known.usdc.address}).`, 'Check the token; clients that only pay USDC will skip this option.');
  } else if (family === 'svm') {
    if (!isSolanaAddress(asset)) add('pr.accept.asset', 'error', `${at}.asset "${asset}" is not a Solana address (base58, 32 bytes).`);
    else if (known?.usdc && known.usdc.address !== asset)
      add('pr.accept.asset-unknown', known.usdc.confidence === 'high' ? 'warn' : 'info', `${at}.asset ${asset} is not the canonical USDC mint on ${networkLabel(network as string)} (${known.usdc.address}).`);
  }

  // payTo
  const payTo = a['payTo'];
  if (typeof payTo !== 'string' || payTo === '') add('pr.accept.pay-to', 'error', `${at}.payTo is missing.`);
  else if (family === 'evm') {
    const state = checksumState(payTo);
    if (state === 'malformed') add('pr.accept.pay-to', 'error', `${at}.payTo "${payTo}" is not an EVM address.`);
    else if (ZERO_EVM.test(payTo)) add('pr.accept.pay-to', 'error', `${at}.payTo is the zero address.`);
    else if (state === 'invalid') add('pr.accept.pay-to', 'error', `${at}.payTo ${payTo} has a wrong EIP-55 checksum (mixed case that does not match).`, 'Copy the wallet address again; a typo here sends money nowhere.');
    else if (state === 'unchecksummed') add('pr.accept.pay-to-checksum', 'warn', `${at}.payTo ${payTo} is not in EIP-55 checksum form; case-sensitive lookups (facilitator discovery by payTo) will not match it.`, 'Use the checksummed address.');
    if (typeof asset === 'string' && asset.toLowerCase() === payTo.toLowerCase()) add('pr.accept.pay-to', 'error', `${at}.payTo equals the asset contract.`);
  } else if (family === 'svm') {
    if (!isSolanaAddress(payTo)) add('pr.accept.pay-to', 'error', `${at}.payTo "${payTo}" is not a Solana address (base58, 32 bytes).`);
    else if (payTo === asset) add('pr.accept.pay-to', 'error', `${at}.payTo equals the asset mint.`);
  }

  // maxTimeoutSeconds
  const timeout = a['maxTimeoutSeconds'];
  if (timeout === undefined) add('pr.accept.timeout', 'error', `${at}.maxTimeoutSeconds is missing.`, 'Set "maxTimeoutSeconds", e.g. 60.');
  else if (typeof timeout !== 'number' || !Number.isInteger(timeout) || timeout <= 0) add('pr.accept.timeout', 'error', `${at}.maxTimeoutSeconds ${JSON.stringify(timeout)} is not a positive integer.`);
  else if (timeout < 10) add('pr.accept.timeout', 'warn', `${at}.maxTimeoutSeconds ${timeout} leaves little time to sign, send and settle.`, 'Use 30-300 seconds.');
  else if (timeout > 3600) add('pr.accept.timeout', 'warn', `${at}.maxTimeoutSeconds ${timeout} is over an hour; a signed authorization stays valid that long.`, 'Use 30-300 seconds.');

  // extra
  const extra = a['extra'];
  if (extra !== undefined && !isObject(extra)) add('pr.accept.extra', 'warn', `${at}.extra is not an object.`);
  const ex = isObject(extra) ? extra : {};
  if (family === 'evm' && scheme === 'exact') {
    const expected = known?.usdc && typeof asset === 'string' && known.usdc.address.toLowerCase() === asset.toLowerCase() ? known.usdc.eip712 : undefined;
    if (typeof ex['name'] !== 'string' || typeof ex['version'] !== 'string') {
      const hint = expected ? `Add "extra": {"name": "${expected.name}", "version": "${expected.version}"}.` : 'Add "extra": {"name", "version"} with the token\'s EIP-712 domain.';
      add('pr.accept.extra', 'warn', `${at}.extra lacks the EIP-712 domain (name, version) the payer signs under; some clients refuse or guess.`, hint);
    } else if (expected && (ex['name'] !== expected.name || ex['version'] !== expected.version)) {
      const sev: Severity = known?.usdc?.confidence === 'high' ? 'warn' : 'info';
      add('pr.accept.extra', sev, `${at}.extra domain is {name: "${String(ex['name'])}", version: "${String(ex['version'])}"}; USDC on ${networkLabel(network as string)} signs as {name: "${expected.name}", version: "${expected.version}"}. Signatures under the wrong domain fail on-chain.`, `Use "name": "${expected.name}", "version": "${expected.version}".`);
    }
  }
  if (family === 'svm' && scheme === 'exact') {
    const feePayer = ex['feePayer'];
    if (feePayer === undefined) add('pr.accept.extra', 'warn', `${at}.extra.feePayer is missing; the Solana "exact" scheme needs the facilitator's fee payer to build the transaction.`, "Copy feePayer from the facilitator's /supported response.");
    else if (!isSolanaAddress(feePayer)) add('pr.accept.extra', 'error', `${at}.extra.feePayer is not a Solana address.`);
  }
}
