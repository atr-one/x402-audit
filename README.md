# x402-audit

Audit an [x402](https://x402.org) seller without paying anything, and find out whether AI agents, x402 clients and
directories will be able to discover and pay it.

x402 sellers answer an unpaid request with HTTP `402 Payment Required` and a `PAYMENT-REQUIRED` header that says what
to pay: which network, which token, how much, to which address. Small mistakes in that header, or in the discovery
documents next to it, are silent: a client skips the offer, a directory drops the endpoint, a signature is made under the
wrong EIP-712 domain and fails on-chain. `x402-audit` reads what a client or a directory reads and reports those
mistakes with a stable check id and a fix.

It targets x402 version 2 (`PAYMENT-REQUIRED` / `PAYMENT-SIGNATURE` / `PAYMENT-RESPONSE` headers, CAIP-2 networks,
`amount` in atomic units).

## Install and run

Requires Node.js 18 or later.

```sh
npx github:atr-one/x402-audit https://example.com
```

The package is not on the npm registry yet; installing from GitHub builds it on the fly (the `prepare` script).

or install it:

```sh
npm install -g github:atr-one/x402-audit
x402-audit https://example.com --endpoint /api/paid --md report.md
```

### Options

| Option | Default | Meaning |
| --- | --- | --- |
| `--endpoint <path or url>` | | A paid endpoint to probe in addition to discovery. Repeatable. |
| `--json <file>` | | Write the full report as JSON. `--json -` prints JSON to stdout instead of the text report. |
| `--md <file>` | | Write a Markdown report. |
| `--fail-on <error\|warn\|none>` | `error` | Exit 1 when a finding of this severity or worse exists. |
| `--timeout <seconds>` | `20` | Per-request timeout. |
| `--concurrency <n>` | `3` | Endpoints probed in parallel. |
| `--max-price <usd>` | `10` | Warn when one call costs more than this. |
| `--max-endpoints <n>` | `50` | Probe at most this many discovered endpoints (`--endpoint` ones always run). |
| `--facilitator-discovery` | off | Ask the facilitator's discovery list whether it knows the seller's resources. |
| `--facilitator <url>` | `https://facilitator.payai.network` | Facilitator used by `--facilitator-discovery`. |
| `--no-v1-probe` | | Do not send the v1 `X-PAYMENT` probe (see `hygiene.v1`). |
| `--user-agent <string>` | `x402-audit/<version> (+https://github.com/atr-one/x402-audit)` | |
| `--verbose` / `--quiet` | | List every endpoint of a grouped finding / hide info findings. |
| `--no-color` | | Plain output. Colors are only used on a TTY, and `NO_COLOR` is honoured. |

Exit codes, as with a linter: `0` no finding at the `--fail-on` level, `1` at least one, `2` usage error or the tool
itself failed. In CI:

```sh
npx --yes github:atr-one/x402-audit#v0.1.0 https://staging.example.com --fail-on warn --md x402-audit.md
```

## What it does

1. Fetches `/.well-known/x402` and `/openapi.json` and collects the paid endpoints: every URL in `resources`, and every
   OpenAPI operation with `x-payment-info`. `--endpoint` adds more.
2. Sends one unpaid request to each endpoint with the documented method. For POST it sends a minimal JSON body built
   from the OpenAPI request schema (examples, defaults, enums, then required properties only).
3. Decodes and validates the `PAYMENT-REQUIRED` header, compares it with the body and with the documented price, and
   checks the Bazaar extension, CORS and response time.
4. Sends one request with a v1 `X-PAYMENT` header holding an unsigned, empty payload, to see what a v1 client is told.
5. Optionally asks the facilitator's discovery list which resources it has catalogued for each `payTo`.

No payment is made, no private key is used, and nothing is signed.

## Checks

Every finding has an id, a severity (`error`, `warn`, `info`), a message and, where there is something to change, a fix.

### Discovery

| Id | Severity | What |
| --- | --- | --- |
| `discovery.well-known.missing` | warn | `/.well-known/x402` not found, not 200, blocked or unreachable. |
| `discovery.well-known.invalid` | error | Not JSON, not an object, or no `resources` array. |
| `discovery.well-known.empty` | warn | `resources` is empty. |
| `discovery.well-known.resource` | warn | Entries that are not absolute http(s) URLs. |
| `discovery.well-known.foreign` | info | Resources on another origin. |
| `discovery.well-known.not-in-openapi` | info | Listed resources with no paid OpenAPI operation. |
| `discovery.openapi.missing` | warn | `/openapi.json` not found, not 200, blocked or unreachable. |
| `discovery.openapi.invalid` | error | Not JSON, no `openapi` version field, or no `paths`. |
| `discovery.openapi.no-paid-operations` | warn | No operation carries `x-payment-info`. |
| `discovery.openapi.security` | error | An empty security requirement encoded as `[]` instead of `{}` (what PHP's `json_encode([])` produces). |
| `discovery.openapi.no-402-response` | info | Paid operations that do not document a 402 response. |
| `discovery.openapi.templated` | info | Paid paths with path parameters and no example value; not probed. |
| `discovery.openapi.not-in-well-known` | info | Paid operations missing from `/.well-known/x402`. |
| `discovery.payment-info.invalid` | error | `x-payment-info` is not an object. |
| `discovery.payment-info.protocols` | error/warn | `protocols` missing, not an array, holds strings such as `["x402"]`, or holds `{"x402": []}`. It must be an array of objects keyed by protocol name: `[{"x402": {}}]`. Discovery parsers drop the whole block otherwise. |
| `discovery.payment-info.no-x402` | warn | `protocols` does not list x402. |
| `discovery.payment-info.price` | error/warn | `price` missing or not a readable USD price. |
| `discovery.truncated` | info | More endpoints than `--max-endpoints`. |
| `discovery.none` | error | No paid endpoint to probe. |

Accepted `x-payment-info` price shapes: `{"mode": "fixed", "currency": "USD", "amount": "0.01"}`,
`{"mode": "dynamic", "currency": "USD", "min": "0.01", "max": "0.10"}`, or a plain `"0.01"`.

### The 402 response

| Id | Severity | What |
| --- | --- | --- |
| `http.unreachable` | error | Network error or timeout. |
| `http.blocked` | error | A bot challenge (for example Cloudflare) answered instead of the application. Agents get the same. |
| `http.status` | error | The unpaid request did not answer 402 (200 means payment is not enforced). |
| `http.payment-required-header` | error | No `PAYMENT-REQUIRED` header (a PaymentRequired only in the body is the v1 style). |
| `http.body` | info | The 402 body is not JSON. |
| `header.size` | warn/error | The header is over 8 KB (warn: payers echo the accepted requirements back, proxies cap header lines at 8-16 KB) or over 16 KB (error: Node's default header limit). |
| `pr.decode` | error/warn | Not base64 JSON (error), or base64url instead of standard base64 (warn). |
| `pr.shape`, `pr.version`, `pr.error-field` | error/warn | Not an object; `x402Version` not 2; `error` not a string. |
| `pr.resource`, `pr.resource.url` | error | `resource` missing, a v1 string, or `url` not absolute. |
| `pr.resource.description`, `pr.resource.mime-type` | warn | Missing; directories show them. |
| `pr.resource.url-mismatch` | info | `resource.url` differs from the URL requested. |
| `pr.accepts` | error | `accepts` missing or empty. |
| `pr.accept.scheme` | error/warn | Missing, or not `exact`. |
| `pr.accept.network` | error | Not CAIP-2, or a v1 name such as `base` (the fix names the CAIP-2 id). |
| `pr.accept.network-unknown` | info | Valid CAIP-2 that is not in the built-in table. |
| `pr.accept.amount` | error | Not a string of atomic units: a number, a decimal like `"0.01"`, zero, or v1 `maxAmountRequired`. |
| `pr.accept.asset` | error | Not an EVM address / Solana mint, or a mixed-case EVM address with a wrong EIP-55 checksum. |
| `pr.accept.asset-checksum` | warn | EVM asset not in checksum form. |
| `pr.accept.asset-unknown` | warn/info | Not the canonical USDC of that network. |
| `pr.accept.pay-to` | error | Malformed, zero address, wrong checksum, or equal to the asset. |
| `pr.accept.pay-to-checksum` | warn | EVM `payTo` not in checksum form. Case-sensitive lookups such as facilitator discovery by `payTo` do not match it. |
| `pr.accept.timeout` | error/warn | `maxTimeoutSeconds` missing or not a positive integer (error); under 10 or over 3600 (warn). |
| `pr.accept.extra` | warn/info/error | EVM `exact`: `extra.name`/`extra.version` (the token's EIP-712 domain) missing or different from the known USDC domain. Solana `exact`: `extra.feePayer` missing or invalid. |
| `pr.extensions` | warn | `extensions` is not an object. |
| `pr.body-mismatch` | warn | The body carries a PaymentRequired (top level, `x402` or `paymentRequired`) whose offers differ from the header. |

### Price

| Id | Severity | What |
| --- | --- | --- |
| `price.mismatch` | warn | The cheapest offer (amount / 10^decimals) does not match the OpenAPI `x-payment-info` price. |
| `price.network-differs` | info | Other offers outside the documented price, for example a per-network minimum. |
| `price.too-low` | warn | Under $0.001 per call: usually a decimals mistake. |
| `price.too-high` | warn | Over `--max-price`. |
| `price.unknown-asset` | info | Offers whose asset is not in the USDC table; not priced. |

### Bazaar extension

| Id | Severity | What |
| --- | --- | --- |
| `bazaar.missing` | warn | No `extensions.bazaar`; facilitator-fed catalogs cannot show how to call the endpoint. |
| `bazaar.shape` | error/warn/info | `info.input` missing, unknown `type`, `http` without `method`, `mcp` without `toolName`, POST without a `body` example. |
| `bazaar.method` | warn | `info.input.method` differs from the method the 402 was answered for. |
| `bazaar.output` | info | No `info.output`. |
| `bazaar.schema` | warn/info | `schema` missing, not an object schema, or `info` does not satisfy it (checked with a JSON Schema subset: type, const, enum, required, properties, additionalProperties, items). |
| `bazaar.size` | info | The extension is most of an oversized header. |

### Protocol hygiene

| Id | Severity | What |
| --- | --- | --- |
| `hygiene.cors-origin` | info | No `Access-Control-Allow-Origin` on the 402. |
| `hygiene.cors-expose` | warn | `Access-Control-Expose-Headers` lacks `PAYMENT-REQUIRED` or `PAYMENT-RESPONSE`, so browser clients cannot read them. |
| `hygiene.latency` | info/warn | The 402 took over 2 s (info) or 5 s (warn). |
| `hygiene.v1` | info/warn/error | What a v1 client sending `X-PAYMENT` gets: an explanation (info), a 5xx (warn), or the resource itself, meaning the payment was not verified (error). |

### Facilitator listing (`--facilitator-discovery`)

| Id | Severity | What |
| --- | --- | --- |
| `facilitator.listed` | info | How many resources the facilitator lists for the `payTo`, and how many of the audited endpoints are among them. |
| `facilitator.not-listed` | warn | None. Facilitators usually catalog a resource after settling a payment for it that carries the Bazaar extension. |
| `facilitator.case` | info | An EVM `payTo` was looked up in checksum form; the lookup is case-sensitive and a lowercase address finds nothing. |
| `facilitator.error` | info | The discovery list could not be read. |

The query is `GET <facilitator>/discovery/resources?payTo=<address>&limit=100`.

## Example

`x402-audit http://127.0.0.1:4020` against the deliberately flawed mock seller used in the tests
(`test/mock-seller.ts`), shortened:

```text
x402-audit 0.1.0  http://127.0.0.1:4020

Discovery
  /.well-known/x402  200  3 resources
  /openapi.json      200  2 paid operations

Endpoints (3)
  402  GET  http://127.0.0.1:4020/api/search  6 ms
        Base $0.02, ethereum 10000, Solana 0.01
  402  POST http://127.0.0.1:4020/api/report  18 ms
        Base $0.02, Ethereum $0.02, Solana $0.02
  402  GET  http://127.0.0.1:4020/api/legacy  14 ms
        base ?

Findings
  error  discovery.openapi.security  top level: "security" holds an array ([]) where a requirement object belongs; the empty requirement must be {}.
         fix: Encode the "no authentication" requirement as {} (in PHP: new \stdClass()).
  error  discovery.payment-info.protocols  GET /api/search: x-payment-info.protocols holds strings ("x402"); discovery parsers expect objects keyed by protocol name and drop the block.
         fix: Use "protocols": [{"x402": {}}] (in PHP: [["x402" => new \stdClass()]]).
  error  http.payment-required-header  No PAYMENT-REQUIRED header; the body carries an x402 v1 PaymentRequired. v2 clients read the header.
         fix: Upgrade to x402 v2: send base64(JSON PaymentRequired) in the PAYMENT-REQUIRED header.
         at: http://127.0.0.1:4020/api/legacy
  error  pr.accept.amount  accepts[2].amount "0.01" is not an integer string of atomic units.
         fix: Amounts are atomic units (integer), not dollars: $0.01 USDC is "10000".
         at: http://127.0.0.1:4020/api/search
  error  pr.accept.network  accepts[1].network "ethereum" is a v1 name; v2 uses CAIP-2.
         fix: Use "eip155:1".
         at: http://127.0.0.1:4020/api/search
  ...
  warn   pr.accept.extra  accepts[0].extra lacks the EIP-712 domain (name, version) the payer signs under; some clients refuse or guess.
         fix: Add "extra": {"name": "USD Coin", "version": "2"}.
         at: http://127.0.0.1:4020/api/search
  warn   pr.accept.pay-to-checksum  accepts[0].payTo 0x5aaeb6053f3e94c9b9a09f33669435e7ef1beaed is not in EIP-55 checksum form; case-sensitive lookups (facilitator discovery by payTo) will not match it.
         fix: Use the checksummed address.
         at: http://127.0.0.1:4020/api/search
  warn   price.mismatch  The cheapest offer is $0.02 (Base (eip155:8453)) but /openapi.json documents $0.01.
         fix: Make x-payment-info.price and the 402 amounts come from the same source.
         at: http://127.0.0.1:4020/api/search
  warn   hygiene.cors-expose  Access-Control-Expose-Headers lacks PAYMENT-REQUIRED and PAYMENT-RESPONSE; browsers hide these headers from client code.
         fix: Access-Control-Expose-Headers: PAYMENT-REQUIRED, PAYMENT-RESPONSE
         at: http://127.0.0.1:4020/api/search, http://127.0.0.1:4020/api/report
  ...

9 errors, 9 warnings, 2 info  (0.1 s)
```

The well-formed mock seller in the same file reports no errors and no warnings. Identical findings on several endpoints
are grouped in the text report; the JSON report keeps one entry per endpoint.

## Library

```ts
import { audit, decodePaymentRequired, validatePaymentRequired, formatMarkdown } from 'x402-audit';

const report = await audit('https://example.com', { endpoints: ['/api/paid'], timeoutMs: 10_000 });
console.log(report.summary); // { error: 0, warn: 2, info: 5 }
console.log(formatMarkdown(report));

// the header on its own, e.g. in a seller's own tests
const decoded = decodePaymentRequired(response.headers.get('payment-required') ?? '');
if (decoded.ok) {
  const { valid, findings } = validatePaymentRequired(decoded.value);
}
```

`audit(origin, options)` options: `endpoints`, `timeoutMs`, `concurrency`, `maxPriceUsd`, `maxEndpoints`,
`facilitatorDiscovery`, `facilitatorUrl`, `probeV1`, `userAgent`, and `fetch` (an injectable fetch for proxies or
tests). Also exported: `toChecksumAddress`, `checksumState`, `isSolanaAddress`, `parseCaip2`, `NETWORKS`, `knownToken`,
`formatUnits`, `parseUnits`, `usdPrice`, `parseOpenApi`, `parseWellKnown`, `parsePaymentInfo`, `formatConsole`,
`exitCode`. The report type is `AuditReport` (see `src/types.ts`).

## Networks and the USDC table

`src/networks.ts` holds the CAIP-2 ids the tool knows and the canonical USDC deployment of each:

| Network | CAIP-2 | USDC | EIP-712 name | Confidence |
| --- | --- | --- | --- | --- |
| Base | `eip155:8453` | `0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913` | USD Coin | high |
| Base Sepolia | `eip155:84532` | `0x036CbD53842c5426634e7929541eC2318f3dCF7e` | USDC | high |
| Ethereum | `eip155:1` | `0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48` | USD Coin | high |
| Ethereum Sepolia | `eip155:11155111` | `0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238` | USDC | high |
| Polygon PoS | `eip155:137` | `0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359` | USD Coin | high |
| Polygon Amoy | `eip155:80002` | `0x41E94Eb019C0762f9Bfcf9Fb1E58725BfB0e7582` | USDC | high |
| Arbitrum One | `eip155:42161` | `0xaf88d065e77c8cC2239327C5EDb3A432268e5831` | USD Coin | high |
| Arbitrum Sepolia | `eip155:421614` | `0x75faf114eafb1BDbe2F0316DF893fd58CE46AA4d` | USD Coin | high |
| OP Mainnet | `eip155:10` | `0x0b2C639c533813f4Aa9D7837CAf62653d097Ff85` | USD Coin | high |
| OP Sepolia | `eip155:11155420` | `0x5fd84259d66Cd46123540766Be93DFE6D43130D7` | USDC | high |
| Avalanche C-Chain | `eip155:43114` | `0xB97EF9Ef8734C71904D8002F8b6Bc66Dd9c48a6E` | USD Coin | high |
| Avalanche Fuji | `eip155:43113` | `0x5425890298aed601595a70AB815c96711a31Bc65` | USD Coin | high |
| Solana | `solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp` | `EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v` | - | high |
| Solana Devnet | `solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1` | `4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU` | - | high |

All entries are native (Circle-issued) USDC with 6 decimals and EIP-712 version `2`; bridged variants such as USDC.e
are not listed and are reported as `pr.accept.asset-unknown`.

The table was checked on 2026-10-30. Every address matches Circle's list,
<https://developers.circle.com/stablecoins/usdc-contract-addresses>, character for character. Circle's list does not
give the EIP-712 domain, so for each EVM entry `name()`, `version()` and `decimals()` were read from the contract over a
public RPC endpoint; USDC signs `transferWithAuthorization` under `name()` and version `2`. A test pins the table to
these values, and another checks that every EVM address carries a valid EIP-55 checksum. Entries can be marked
`medium` confidence when they are not verified against the issuer's list; a mismatch against such an entry is reported
as info rather than a warning. No entry is `medium` at present.

To add a network, add an entry to `NETWORKS` with its CAIP-2 id, name, `testnet`, the v1 short name if there was one,
and the token (`address`, `decimals`, `eip712` for EVM, `confidence`). Please cite the issuer's contract list in the
pull request.

## Limitations

- No payment is made. Settlement, facilitator `/verify` and `/settle`, signature validity and on-chain balances are out
  of scope; a seller can pass every check and still fail to settle.
- One unpaid request per endpoint (plus one v1 probe per audit). Prices that depend on arguments are checked for the
  arguments sent, which are the documented minimal ones.
- Paths with path parameters are probed only when the OpenAPI document gives an example, default or enum.
- The Bazaar schema check is a subset of JSON Schema, not a full validator.
- The x402 MCP transport (`_meta["x402/payment"]`) is not audited; only HTTP endpoints.
- A seller behind a bot challenge is reported as `http.blocked`. The tool does not try to get around it.

## Development

```sh
npm install
npm test        # vitest, including an in-process mock seller
npm run lint    # tsc --noEmit
npm run build   # dist/
```

## License

MIT. Copyright (c) 2026 Dmitrii Maslennikov.
