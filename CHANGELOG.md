# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project uses [Semantic Versioning](https://semver.org/).

## [0.2.0] - 2026-10-30

### Added

- `--network <caip2 or alias>` (repeatable or comma-separated) and the `networks` option of `audit()`: audit only the
  offers on those networks. Aliases such as `base`, `base-sepolia`, `ethereum`, `solana` resolve to CAIP-2; an offer
  with a v1 network name counts as that network. New check `network.not-offered` (error) when an endpoint has no offer
  on the selected networks. `validatePaymentRequired(value, { networks })` takes the same selection. New exports:
  `resolveNetwork`, `onNetworks`, `NETWORK_ALIASES`, `priceRows`.
- A price table in the text and Markdown reports: one row per offer with endpoint, method, network, price in USD and
  asset symbol.
- GitHub Action (`action.yml`, composite): `uses: atr-one/x402-audit@v0.2.0` with the inputs `origin`, `endpoints`,
  `fail-on`, `json`, `md` and `facilitator-discovery`; the Markdown report goes to the job summary. CI runs it against
  the mock seller.
- `npm run mock-seller -- good|flawed [port]` runs the mock seller from the tests as a standalone server.
- USDC for Arbitrum Sepolia (`0x75faf114eafb1BDbe2F0316DF893fd58CE46AA4d`) and OP Sepolia
  (`0x5fd84259d66Cd46123540766Be93DFE6D43130D7`).

### Changed

- The USDC table was checked against Circle's contract list
  (https://developers.circle.com/stablecoins/usdc-contract-addresses) on 2026-10-30: every address matched; the EIP-712
  names were read from the contracts on-chain and matched too. Ethereum Sepolia, Polygon Amoy and Avalanche Fuji went
  from `medium` to `high` confidence, so a non-canonical asset or a wrong EIP-712 domain on them is now a warning instead of info.
- The offers line under each endpoint in the text report, and the Offers column of the Markdown endpoint table, gave
  way to the price table.

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
