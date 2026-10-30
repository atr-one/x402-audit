#!/usr/bin/env node
import { writeFileSync } from 'node:fs';
import { parseArgs } from 'node:util';
import { audit } from './index.js';
import { VERSION } from './http.js';
import { resolveNetwork } from './networks.js';
import { exitCode, formatConsole, formatMarkdown, type FailOn } from './report.js';

const HELP = `x402-audit ${VERSION} - audit an x402 seller without paying

Usage: x402-audit <origin> [options]

  <origin>                    e.g. https://example.com (paths are ignored; use --endpoint)

Options:
  --endpoint <path|url>       a paid endpoint to probe in addition to discovery (repeatable)
  --network <caip2|alias>     audit only offers on this network, e.g. base, base-sepolia, ethereum, solana,
                              eip155:8453 (repeatable, or comma-separated)
  --json <file>               write the full report as JSON ("-" for stdout instead of the text report)
  --md <file>                 write a Markdown report
  --fail-on <error|warn|none> exit 1 when a finding of this severity or worse exists (default: error)
  --timeout <seconds>         per-request timeout (default: 20)
  --concurrency <n>           endpoints probed in parallel (default: 3)
  --max-price <usd>           warn when one call costs more (default: 10)
  --max-endpoints <n>         probe at most n discovered endpoints (default: 50)
  --facilitator-discovery     check whether the facilitator's discovery list knows the payTo's resources
  --facilitator <url>         facilitator for that check (default: https://facilitator.payai.network)
  --no-v1-probe               do not send the v1 X-PAYMENT probe
  --user-agent <string>       override the User-Agent
  --verbose                   list every endpoint of a grouped finding
  --quiet                     hide info findings in the text report
  --no-color                  plain text output (also: NO_COLOR=1)
  -h, --help                  show this help
  -v, --version               show the version

Exit codes: 0 no finding at the --fail-on level, 1 findings at that level, 2 usage error or the tool failed.
No payment is ever made.`;

function fail(message: string): never {
  process.stderr.write(`x402-audit: ${message}\n\nRun x402-audit --help for usage.\n`);
  process.exit(2);
}

function positiveNumber(value: string | undefined, name: string, fallback: number): number {
  if (value === undefined) return fallback;
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) fail(`${name} must be a positive number, got "${value}"`);
  return n;
}

async function main(): Promise<void> {
  let parsed;
  try {
    parsed = parseArgs({
      allowPositionals: true,
      options: {
        endpoint: { type: 'string', multiple: true },
        network: { type: 'string', multiple: true },
        json: { type: 'string' },
        md: { type: 'string' },
        'fail-on': { type: 'string' },
        timeout: { type: 'string' },
        concurrency: { type: 'string' },
        'max-price': { type: 'string' },
        'max-endpoints': { type: 'string' },
        'facilitator-discovery': { type: 'boolean' },
        facilitator: { type: 'string' },
        'no-v1-probe': { type: 'boolean' },
        'user-agent': { type: 'string' },
        verbose: { type: 'boolean' },
        quiet: { type: 'boolean' },
        'no-color': { type: 'boolean' },
        help: { type: 'boolean', short: 'h' },
        version: { type: 'boolean', short: 'v' }
      }
    });
  } catch (e) {
    fail((e as Error).message);
  }
  const { values: o, positionals } = parsed;
  if (o.help) {
    process.stdout.write(HELP + '\n');
    return;
  }
  if (o.version) {
    process.stdout.write(VERSION + '\n');
    return;
  }
  if (positionals.length !== 1) fail(positionals.length ? 'give exactly one origin' : 'missing origin');
  const failOn = (o['fail-on'] ?? 'error') as FailOn;
  if (!['error', 'warn', 'none'].includes(failOn)) fail(`--fail-on must be error, warn or none, got "${failOn}"`);
  const concurrency = Math.floor(positiveNumber(o.concurrency, '--concurrency', 3));
  const maxEndpoints = Math.floor(positiveNumber(o['max-endpoints'], '--max-endpoints', 50));
  const networks: string[] = [];
  for (const n of (o.network ?? []).flatMap((v) => v.split(','))) {
    if (n.trim() === '') continue;
    const id = resolveNetwork(n);
    if (!id) fail(`unknown network "${n.trim()}": use a CAIP-2 id such as eip155:8453 or an alias such as base, base-sepolia, ethereum, solana`);
    if (!networks.includes(id)) networks.push(id);
  }

  const report = await audit(positionals[0] as string, {
    endpoints: o.endpoint ?? [],
    ...(networks.length ? { networks } : {}),
    timeoutMs: positiveNumber(o.timeout, '--timeout', 20) * 1000,
    concurrency,
    maxEndpoints,
    maxPriceUsd: positiveNumber(o['max-price'], '--max-price', 10),
    facilitatorDiscovery: o['facilitator-discovery'] ?? false,
    ...(o.facilitator ? { facilitatorUrl: o.facilitator } : {}),
    probeV1: !o['no-v1-probe'],
    ...(o['user-agent'] ? { userAgent: o['user-agent'] } : {})
  });

  const json = JSON.stringify(report, null, 2) + '\n';
  if (o.json === '-') process.stdout.write(json);
  else {
    const color = !o['no-color'] && !process.env['NO_COLOR'] && process.stdout.isTTY === true;
    process.stdout.write(formatConsole(report, { color, verbose: o.verbose ?? false, quiet: o.quiet ?? false }) + '\n');
    if (o.json) writeFileSync(o.json, json);
  }
  if (o.md) writeFileSync(o.md, formatMarkdown(report));
  process.exitCode = exitCode(report, failOn);
}

main().catch((e: unknown) => {
  process.stderr.write(`x402-audit: ${(e as Error)?.stack ?? String(e)}\n`);
  process.exit(2);
});
