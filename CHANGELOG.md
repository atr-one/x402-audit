# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project uses [Semantic Versioning](https://semver.org/).

## [0.1.0] - 2026-10-30

### Added

- CLI `x402-audit <origin>` with `--endpoint`, `--json`, `--md`, `--fail-on`, `--timeout`, `--concurrency`,
  `--max-price`, `--max-endpoints`, `--facilitator-discovery`, `--facilitator`, `--no-v1-probe`, `--user-agent`,
  `--verbose`, `--quiet`, `--no-color`; exit codes 0/1/2.
- Discovery from `/.well-known/x402` and `/openapi.json` (`x-payment-info`), including the `protocols` object pitfall
  and the empty security requirement encoded as `[]`.
- Unpaid probe of each paid endpoint with the documented method and a minimal JSON body for POST.
- `decodePaymentRequired` and `validatePaymentRequired` for x402 v2 PaymentRequired: version, resource, CAIP-2 networks,
  atomic amounts, EIP-55 and Solana address checks, canonical USDC per network, `maxTimeoutSeconds`, EIP-712 domain and
  Solana fee payer in `extra`.
- Price consistency against `x-payment-info` and sane bounds.
- Bazaar extension checks (shape, method, info against its own schema) and header size limits.
- Protocol hygiene: CORS exposure of `PAYMENT-REQUIRED` / `PAYMENT-RESPONSE`, 402 latency, the answer to a v1
  `X-PAYMENT` client.
- Optional facilitator listing check against the PayAI discovery list.
- Text, JSON and Markdown reports; library entry point `audit(origin, options)`.
