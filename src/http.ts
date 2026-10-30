export const VERSION = '0.2.0';
export const REPO_URL = 'https://github.com/atr-one/x402-audit';
export const DEFAULT_USER_AGENT = `x402-audit/${VERSION} (+${REPO_URL})`;

export interface HttpContext {
  fetch: typeof fetch;
  timeoutMs: number;
  userAgent: string;
}

export interface HttpResult {
  url: string;
  status?: number;
  headers: Headers;
  text: string;
  timeMs: number;
  /** Network error or timeout message; status is undefined then. */
  error?: string;
}

/** One request with a timeout. Never throws: failures come back in `error`. Bodies are capped at 5 MB. */
export async function request(
  ctx: HttpContext,
  url: string,
  init: { method?: string; headers?: Record<string, string>; body?: string } = {}
): Promise<HttpResult> {
  const started = Date.now();
  const headers: Record<string, string> = { 'User-Agent': ctx.userAgent, Accept: 'application/json, */*;q=0.5', ...init.headers };
  try {
    const res = await ctx.fetch(url, {
      method: init.method ?? 'GET',
      headers,
      body: init.body,
      redirect: 'follow',
      signal: AbortSignal.timeout(ctx.timeoutMs)
    });
    const buf = await res.arrayBuffer();
    const text = new TextDecoder().decode(buf.byteLength > 5_000_000 ? buf.slice(0, 5_000_000) : buf);
    return { url, status: res.status, headers: res.headers, text, timeMs: Date.now() - started };
  } catch (e) {
    const err = e as Error & { cause?: { code?: string; message?: string } };
    const reason = err.name === 'TimeoutError' || err.name === 'AbortError' ? `timed out after ${ctx.timeoutMs} ms` : err.cause?.code ?? err.cause?.message ?? err.message;
    return { url, headers: new Headers(), text: '', timeMs: Date.now() - started, error: reason };
  }
}

export function parseJson(text: string): { ok: true; value: unknown } | { ok: false } {
  try {
    return { ok: true, value: JSON.parse(text) };
  } catch {
    return { ok: false };
  }
}

/** A 403/503 that comes from a bot challenge rather than the application. */
export function looksLikeBotWall(res: HttpResult): string | undefined {
  if (res.status !== 403 && res.status !== 503 && res.status !== 429) return undefined;
  const server = (res.headers.get('server') ?? '').toLowerCase();
  const body = res.text.slice(0, 4000);
  if (res.headers.get('cf-mitigated') || /just a moment|challenge-platform|cf-chl/i.test(body)) return 'a Cloudflare challenge';
  if (server.includes('cloudflare') && res.status === 403) return 'Cloudflare (403)';
  if (/akamai|incapsula|sucuri|ddos-guard/i.test(server)) return server;
  return undefined;
}

/** Run `fn` over `items` with at most `limit` in flight; results keep input order. */
export async function mapPool<T, R>(items: T[], limit: number, fn: (item: T, index: number) => Promise<R>): Promise<R[]> {
  const out = new Array<R>(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i] as T, i);
    }
  });
  await Promise.all(workers);
  return out;
}
