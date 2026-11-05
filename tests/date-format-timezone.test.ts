/**
 * Dates shown to people are formatted in Asia/Dhaka (audit 2026-10-31, F-06).
 *
 * Vercel runs in UTC. `new Date(x).toLocaleString('bn-BD')` without a
 * timeZone prints server-local time: on the admin readiness card a cron
 * "last run" read 6 hours behind, and in SSR'd client components the server
 * (UTC) and browser (Dhaka) render different text near midnight — a
 * hydration mismatch. src/lib/date.ts already formats in APP_TIME_ZONE; this
 * pins that every `new Date(…).toLocale*String('…')` without options goes
 * through it instead, and that the helper really prints Dhaka time on a
 * UTC server.
 */
import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = path.join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.(tsx?)$/.test(name)) out.push(p);
  }
  return out;
}

describe('date formatting timezone', () => {
  it('no bare new Date(...).toLocale*String(locale) outside src/lib/date.ts', () => {
    const offenders: string[] = [];
    for (const file of walk(path.resolve(__dirname, '../src'))) {
      if (file.endsWith(path.join('lib', 'date.ts'))) continue;
      readFileSync(file, 'utf8').split('\n').forEach((line, i) => {
        if (/new Date\([^)]*\)\.toLocale(Date|Time)?String\(\s*'[^']*'\s*\)/.test(line)) {
          offenders.push(`${path.relative(process.cwd(), file)}:${i + 1}`);
        }
      });
    }
    expect(offenders).toEqual([]);
  });

  it('fmtDate prints Dhaka wall-clock time even when the process runs in UTC', async () => {
    const prev = process.env.TZ;
    process.env.TZ = 'UTC';
    try {
      const { fmtDate } = await import('../src/lib/date');
      // 2026-10-30 20:30 UTC == 2026-10-31 02:30 in Dhaka
      const out = fmtDate(new Date('2026-10-30T20:30:00Z'));
      expect(out).toMatch(/31/);
      expect(out).toMatch(/02:30|2:30/);
    } finally {
      process.env.TZ = prev;
    }
  });
});
