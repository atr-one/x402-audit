export type Severity = 'error' | 'warn' | 'info';

export const SEVERITY_RANK: Record<Severity, number> = { info: 0, warn: 1, error: 2 };

/** One result of a check. `id` is stable and documented in the README. */
export interface Finding {
  id: string;
  severity: Severity;
  message: string;
  /** How to fix it, when there is something to fix. */
  fix?: string;
  /** The endpoint the finding is about (absent for site-wide findings). */
  endpoint?: string;
}

export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

/** A documented price from OpenAPI `x-payment-info`, in USD. */
export type DocumentedPrice =
  | { mode: 'fixed'; amount: number }
  | { mode: 'dynamic'; min: number; max: number };

/** A paid endpoint found by discovery (or given on the command line). */
export interface PaidEndpoint {
  url: string;
  method: HttpMethod;
  /** Where it came from: `well-known`, `openapi`, `cli`, or several. */
  sources: string[];
  /** OpenAPI path template, when the endpoint is documented there. */
  openapiPath?: string;
  price?: DocumentedPrice;
  protocols?: string[];
  /** JSON body to send for POST (built from the OpenAPI request schema). */
  body?: unknown;
}

/** x402 v2 PaymentRequirements (one entry of `accepts`). */
export interface PaymentRequirements {
  scheme: string;
  network: string;
  amount: string;
  asset: string;
  payTo: string;
  maxTimeoutSeconds: number;
  extra?: Record<string, unknown>;
  [key: string]: unknown;
}

/** x402 v2 PaymentRequired (the decoded `PAYMENT-REQUIRED` header). */
export interface PaymentRequired {
  x402Version: number;
  error?: string;
  resource: { url: string; description?: string; mimeType?: string; [key: string]: unknown };
  accepts: PaymentRequirements[];
  extensions?: Record<string, unknown>;
  [key: string]: unknown;
}

export interface EndpointResult {
  url: string;
  method: HttpMethod;
  sources: string[];
  status?: number;
  timeMs?: number;
  headerBytes?: number;
  paymentRequired?: PaymentRequired;
  findings: Finding[];
}

export interface DiscoveryResult {
  wellKnown: { url: string; status?: number; ok: boolean; resources: string[] };
  openapi: { url: string; status?: number; ok: boolean; paidOperations: number };
  endpoints: PaidEndpoint[];
  findings: Finding[];
}

export interface FacilitatorResult {
  url: string;
  payTo: string;
  listed: string[];
  total?: number;
  findings: Finding[];
}

export interface AuditReport {
  tool: { name: string; version: string };
  origin: string;
  startedAt: string;
  durationMs: number;
  discovery: DiscoveryResult;
  endpoints: EndpointResult[];
  facilitator?: FacilitatorResult[];
  /** The CAIP-2 networks the audit was restricted to (`networks` option); absent when every offer was audited. */
  networks?: string[];
  findings: Finding[];
  summary: { error: number; warn: number; info: number };
}

export interface AuditOptions {
  /** Extra endpoints (absolute URLs or paths on the origin), probed with GET unless OpenAPI says otherwise. */
  endpoints?: string[];
  /** Per-request timeout in milliseconds. Default 20000. */
  timeoutMs?: number;
  /** Parallel endpoint probes. Default 3. */
  concurrency?: number;
  /** Highest acceptable price per call in USD before a warning. Default 10. */
  maxPriceUsd?: number;
  /** Query the PayAI facilitator discovery list for each payTo. Default false. */
  facilitatorDiscovery?: boolean;
  /** Facilitator discovery base URL. Default https://facilitator.payai.network */
  facilitatorUrl?: string;
  /** Send a probe with a v1 `X-PAYMENT` header to see how v1 clients are answered. Default true. */
  probeV1?: boolean;
  /**
   * Audit only the offers on these networks: CAIP-2 ids or aliases such as `base`, `base-sepolia`, `ethereum`,
   * `solana` (see `NETWORK_ALIASES`). Offers on other networks are not validated, priced or shown. Default: all.
   */
  networks?: string[];
  /** Probe at most this many endpoints found by discovery (CLI endpoints are always probed). Default 50. */
  maxEndpoints?: number;
  userAgent?: string;
  /** Injectable fetch (tests, proxies). Defaults to global fetch. */
  fetch?: typeof fetch;
}
