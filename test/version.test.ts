import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { DEFAULT_USER_AGENT, VERSION } from '../src/http.js';

describe('package metadata', () => {
  it('keeps VERSION in step with package.json and names the repo in the User-Agent', () => {
    const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as { version: string };
    expect(VERSION).toBe(pkg.version);
    expect(DEFAULT_USER_AGENT).toBe(`x402-audit/${pkg.version} (+https://github.com/atr-one/x402-audit)`);
  });
});
