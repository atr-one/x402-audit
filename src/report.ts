import { knownToken, NETWORKS, networkLabel, onNetworks } from './networks.js';
import { formatUnits } from './price.js';
import { SEVERITY_RANK, type AuditReport, type Finding, type HttpMethod, type Severity } from './types.js';

export type FailOn = 'error' | 'warn' | 'none';

/** 1 when a finding at or above `failOn` exists, else 0. (The CLI uses 2 for a failure of the tool itself.) */
export function exitCode(report: AuditReport, failOn: FailOn = 'error'): 0 | 1 {
  if (failOn === 'none') return 0;
  const min = SEVERITY_RANK[failOn];
  return report.findings.some((f) => SEVERITY_RANK[f.severity] >= min) ? 1 : 0;
}

interface Group {
  severity: Severity;
  id: string;
  message: string;
  fix?: string;
  endpoints: string[];
}

/** Collapse identical findings reported for several endpoints into one line with the endpoint list. */
export function groupFindings(findings: Finding[]): Group[] {
  const map = new Map<string, Group>();
  for (const f of findings) {
    const key = `${f.severity}\u0000${f.id}\u0000${f.message}`;
    let g = map.get(key);
    if (!g) {
      g = { severity: f.severity, id: f.id, message: f.message, endpoints: [] };
      if (f.fix) g.fix = f.fix;
      map.set(key, g);
    }
    if (f.endpoint && !g.endpoints.includes(f.endpoint)) g.endpoints.push(f.endpoint);
  }
  return [...map.values()].sort((a, b) => SEVERITY_RANK[b.severity] - SEVERITY_RANK[a.severity] || a.id.localeCompare(b.id));
}

/** One offer of one endpoint, as shown in the price table. */
export interface PriceRow {
  /** The endpoint URL. */
  endpoint: string;
  method: HttpMethod;
  /** The offer's `network` as sent (CAIP-2, or whatever the seller put there). */
  network: string;
  /** The network's name from the table, or the raw `network`. */
  networkName: string;
  /** Exact USD price ("0.01") when the asset is a known USD stablecoin and the amount is atomic units. */
  priceUsd?: string;
  /** The raw `amount` as sent, when it is a string. */
  amount?: string;
  /** The raw `asset` as sent. */
  asset: string;
  /** "USDC" when the asset is the canonical USDC of the network. */
  symbol?: string;
}

/** Every offer of every endpoint that answered a PaymentRequired, limited to `report.networks` when it is set. */
export function priceRows(report: AuditReport): PriceRow[] {
  const selected = report.networks ? new Set(report.networks) : undefined;
  const rows: PriceRow[] = [];
  for (const e of report.endpoints) {
    const accepts = e.paymentRequired?.accepts;
    if (!Array.isArray(accepts)) continue;
    for (const a of accepts) {
      if (typeof a !== 'object' || a === null || !onNetworks(a.network, selected)) continue;
      const network = String(a.network);
      const asset = typeof a.asset === 'string' ? a.asset : String(a.asset);
      const token = typeof a.network === 'string' && typeof a.asset === 'string' ? knownToken(a.network, a.asset) : undefined;
      const row: PriceRow = { endpoint: e.url, method: e.method, network, networkName: NETWORKS[network]?.name ?? network, asset };
      if (typeof a.amount === 'string') row.amount = a.amount;
      if (token) row.symbol = token.symbol;
      if (token && typeof a.amount === 'string' && /^\d+$/.test(a.amount)) row.priceUsd = formatUnits(a.amount, token.decimals);
      rows.push(row);
    }
  }
  return rows;
}

/** The cells of the price table: endpoint (a path when on the audited origin), method, network, price, asset. */
function priceCells(report: AuditReport): string[][] {
  return priceRows(report).map((r) => {
    let endpoint = r.endpoint;
    try {
      const u = new URL(r.endpoint);
      if (u.origin === report.origin) endpoint = u.pathname + u.search;
    } catch {
      /* keep the URL as is */
    }
    const asset = r.symbol ?? (r.asset.length > 14 ? `${r.asset.slice(0, 6)}...${r.asset.slice(-4)}` : r.asset || '?');
    return [endpoint, r.method, r.networkName, r.priceUsd !== undefined ? `$${r.priceUsd}` : '-', asset];
  });
}

const PRICE_HEADER = ['Endpoint', 'Method', 'Network', 'Price (USD)', 'Asset'];

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;

/** Plain-text report. `verbose` lists every endpoint of a grouped finding; `quiet` hides info findings. */
export function formatConsole(report: AuditReport, opts: { color?: boolean; verbose?: boolean; quiet?: boolean } = {}): string {
  const c = opts.color
    ? { red: (s: string) => `\x1b[31m${s}\x1b[0m`, yellow: (s: string) => `\x1b[33m${s}\x1b[0m`, dim: (s: string) => `\x1b[2m${s}\x1b[0m`, bold: (s: string) => `\x1b[1m${s}\x1b[0m`, green: (s: string) => `\x1b[32m${s}\x1b[0m`, cyan: (s: string) => `\x1b[36m${s}\x1b[0m` }
    : { red: (s: string) => s, yellow: (s: string) => s, dim: (s: string) => s, bold: (s: string) => s, green: (s: string) => s, cyan: (s: string) => s };
  const sev = (s: Severity) => (s === 'error' ? c.red('error') : s === 'warn' ? c.yellow('warn ') : c.cyan('info '));
  const lines: string[] = [];
  lines.push(c.bold(`x402-audit ${report.tool.version}  ${report.origin}`));
  if (report.networks) lines.push(`Networks: ${report.networks.map(networkLabel).join(', ')}; offers on other networks are not audited`);
  lines.push('');

  const d = report.discovery;
  lines.push(c.bold('Discovery'));
  lines.push(`  /.well-known/x402  ${String(d.wellKnown.status ?? '---').padEnd(4)} ${d.wellKnown.ok ? plural(d.wellKnown.resources.length, 'resource') : c.dim('not usable')}`);
  lines.push(`  /openapi.json      ${String(d.openapi.status ?? '---').padEnd(4)} ${d.openapi.ok ? plural(d.openapi.paidOperations, 'paid operation') : c.dim('not usable')}`);
  lines.push('');

  lines.push(c.bold(`Endpoints (${report.endpoints.length})`));
  for (const e of report.endpoints) {
    const status = e.status === undefined ? '---' : String(e.status);
    const st = e.status === 402 ? c.green(status) : c.red(status);
    const ms = e.timeMs !== undefined ? c.dim(`${e.timeMs} ms`) : '';
    lines.push(`  ${st}  ${e.method.padEnd(4)} ${e.url}  ${ms}`);
  }
  lines.push('');

  const cells = priceCells(report);
  lines.push(c.bold('Prices'));
  if (cells.length === 0) lines.push('  none');
  else {
    const widths = PRICE_HEADER.map((h, i) => Math.max(h.length, ...cells.map((r) => (r[i] as string).length)));
    const fmt = (r: string[]) => '  ' + r.map((v, i) => (i === r.length - 1 ? v : v.padEnd(widths[i] as number))).join('  ');
    lines.push(c.dim(fmt(PRICE_HEADER)));
    for (const r of cells) lines.push(fmt(r));
  }
  lines.push('');

  const groups = groupFindings(report.findings).filter((g) => !opts.quiet || g.severity !== 'info');
  lines.push(c.bold('Findings'));
  if (groups.length === 0) lines.push('  none');
  for (const g of groups) {
    lines.push(`  ${sev(g.severity)}  ${c.bold(g.id)}  ${g.message}`);
    if (g.fix) lines.push(`         ${c.dim('fix: ' + g.fix)}`);
    if (g.endpoints.length === 1) lines.push(`         ${c.dim('at: ' + g.endpoints[0])}`);
    else if (g.endpoints.length > 1) {
      const shown = opts.verbose ? g.endpoints : g.endpoints.slice(0, 2);
      lines.push(`         ${c.dim(`at: ${shown.join(', ')}${g.endpoints.length > shown.length ? ` and ${g.endpoints.length - shown.length} more` : ''}`)}`);
    }
  }
  lines.push('');
  const s = report.summary;
  const summary = `${plural(s.error, 'error')}, ${plural(s.warn, 'warning')}, ${s.info} info  (${(report.durationMs / 1000).toFixed(1)} s)`;
  lines.push(s.error ? c.red(summary) : s.warn ? c.yellow(summary) : c.green(summary));
  return lines.join('\n');
}

const mdEscape = (s: string) => s.replace(/\|/g, '\\|').replace(/\n/g, ' ');

export function formatMarkdown(report: AuditReport): string {
  const out: string[] = [];
  const s = report.summary;
  out.push(`# x402 audit: ${report.origin}`, '');
  out.push(`${report.tool.name} ${report.tool.version}, ${report.startedAt}. ${plural(s.error, 'error')}, ${plural(s.warn, 'warning')}, ${s.info} info.`, '');
  if (report.networks) out.push(`Only offers on ${report.networks.map((n) => mdEscape(networkLabel(n))).join(', ')} were audited.`, '');
  out.push('## Discovery', '', '| Document | Status | Result |', '| --- | --- | --- |');
  const d = report.discovery;
  out.push(`| \`/.well-known/x402\` | ${d.wellKnown.status ?? '-'} | ${d.wellKnown.ok ? plural(d.wellKnown.resources.length, 'resource') : 'not usable'} |`);
  out.push(`| \`/openapi.json\` | ${d.openapi.status ?? '-'} | ${d.openapi.ok ? plural(d.openapi.paidOperations, 'paid operation') : 'not usable'} |`, '');
  out.push('## Endpoints', '', '| Status | Method | URL | Time |', '| --- | --- | --- | --- |');
  for (const e of report.endpoints) out.push(`| ${e.status ?? '-'} | ${e.method} | ${mdEscape(e.url)} | ${e.timeMs ?? '-'} ms |`);
  out.push('', '## Prices', '');
  const cells = priceCells(report);
  if (cells.length === 0) out.push('No offers.');
  else {
    out.push(`| ${PRICE_HEADER.join(' | ')} |`, '| --- | --- | --- | ---: | --- |');
    for (const r of cells) out.push(`| ${r.map((v, i) => (i === 0 ? '`' + v.replace(/`/g, '') + '`' : mdEscape(v))).join(' | ')} |`);
  }
  out.push('', '## Findings', '');
  const groups = groupFindings(report.findings);
  if (groups.length === 0) out.push('None.');
  else {
    out.push('| Severity | Check | Message | Fix | Endpoints |', '| --- | --- | --- | --- | --- |');
    for (const g of groups) out.push(`| ${g.severity} | \`${g.id}\` | ${mdEscape(g.message)} | ${mdEscape(g.fix ?? '')} | ${g.endpoints.length ? (g.endpoints.length === 1 ? mdEscape(g.endpoints[0] as string) : `${g.endpoints.length} endpoints`) : 'site'} |`);
  }
  return out.join('\n') + '\n';
}
