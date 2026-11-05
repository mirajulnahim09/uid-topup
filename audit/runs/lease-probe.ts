/**
 * sla-breach lease boundary probe. Not part of the repo's test suite.
 *   npx tsx audit/runs/lease-probe.ts serve <port>   → `next start` from .next-test, test env
 *   npx tsx audit/runs/lease-probe.ts probe <base> <iterations>
 * Repeats exactly the step that failed in tests/sla-breach-job.test.ts:103 —
 * write an "expired" lease stamped with THIS process's clock, then call the
 * cron route, whose server process compares against ITS clock — once with the
 * test's 1 ms margin and once with 1000 ms. Uses only the docker test DB.
 */
import { spawn } from 'node:child_process';
import path from 'node:path';
import { PrismaClient } from '@prisma/client';
import { TEST_ISOLATED_ENV, TEST_DATABASE_URL, TEST_NEXTAUTH_SECRET, TEST_CRON_SECRET, assertSafeTestUrl } from '../../tests/helpers/testEnv';

const ROOT = process.cwd();
const KEY = 'job-lease:sla-breach';

function serve(port: string) {
  assertSafeTestUrl(TEST_DATABASE_URL);
  const { DATABASE_URL: _a, DIRECT_URL: _b, ...rest } = process.env;
  const env = {
    ...rest, ...TEST_ISOLATED_ENV,
    DATABASE_URL: TEST_DATABASE_URL, DIRECT_URL: TEST_DATABASE_URL, NEXT_DIST_DIR: '.next-test',
    NEXTAUTH_URL: `http://127.0.0.1:${port}`, NEXTAUTH_SECRET: TEST_NEXTAUTH_SECRET, TRUSTED_PROXY: '',
  };
  const bin = path.join(ROOT, 'node_modules', 'next', 'dist', 'bin', 'next');
  const p = spawn(process.execPath, [bin, 'start', '-p', port, '-H', '127.0.0.1'], { cwd: ROOT, env, stdio: 'inherit' });
  p.on('exit', (c) => process.exit(c ?? 0));
}

async function probe(base: string, iterations: number) {
  assertSafeTestUrl(TEST_DATABASE_URL);
  for (let i = 0; i < 120; i++) {
    try { if ((await fetch(base + '/api/health')).status) break; } catch { /* not up yet */ }
    await new Promise((r) => setTimeout(r, 1000));
  }
  const db = new PrismaClient({ datasources: { db: { url: TEST_DATABASE_URL } } });
  const call = async () => {
    const r = await fetch(`${base}/api/cron/sla-breach`, { method: 'POST', headers: { authorization: `Bearer ${TEST_CRON_SECRET}` } });
    return (await r.json()) as { skipped?: boolean };
  };
  for (const margin of [1, 1000]) {
    let skipped = 0;
    const skew: number[] = []; // server run start − this process's clock just before the request
    for (let i = 0; i < iterations; i++) {
      const value = `other|${Date.now() - margin}`; // same shape as the test fixture
      await db.setting.upsert({ where: { key: KEY }, update: { value }, create: { key: KEY, value } });
      const before = Date.now();
      if ((await call()).skipped) skipped++;
      else {
        const rec = await db.setting.findUnique({ where: { key: 'job_lastrun_sla-breach' } });
        if (rec) {
          const r = JSON.parse(rec.value) as { at: string; ms?: number };
          skew.push(new Date(r.at).getTime() - (r.ms ?? 0) - before);
        }
      }
      await db.setting.deleteMany({ where: { key: KEY } });
    }
    skew.sort((a, b) => a - b);
    const q = (p: number) => skew.length ? skew[Math.min(skew.length - 1, Math.floor(p * skew.length))] : NaN;
    console.log(`margin ${margin} ms: expired lease judged ACTIVE (skipped) in ${skipped}/${iterations} runs; ` +
      `server-start − client-before (ms) over ${skew.length} completed runs: min ${q(0)} p10 ${q(0.1)} median ${q(0.5)} max ${q(0.999)}`);
  }
  await db.$disconnect();
}

const [cmd, a1, a2] = process.argv.slice(2);
if (cmd === 'serve') serve(a1);
else if (cmd === 'probe') probe(a1, Number(a2 || 300)).then(() => process.exit(0));
else { console.error('usage: serve <port> | probe <base> <iterations>'); process.exit(2); }
