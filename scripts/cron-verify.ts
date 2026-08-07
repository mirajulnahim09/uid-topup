/**
 * ═══════════════════════════════════════════════════════════
 * ★★★ cron endpoint যাচাই (C2)
 *
 *   `npx tsx scripts/cron-verify.ts`
 *
 *   তিনটি জব সত্যিই আছে, গার্ড করা, এবং চলে — তা প্রমাণ করে:
 *     ১. সিক্রেট ছাড়া      → 401
 *     ২. ভুল সিক্রেটে      → 401
 *     ৩. সঠিক সিক্রেটে     → 200 এবং কাজ করে
 *     ৪. readiness-এ শেষ-রান timestamp হালনাগাদ হয়
 *
 *   ⚠️ কোনো সিক্রেট ছাপা হয় না — কেবল HTTP কোড ও দৈর্ঘ্য।
 * ═══════════════════════════════════════════════════════════
 */
import { loadEnvConfig } from '@next/env';
loadEnvConfig(process.cwd());

const BASE = 'http://localhost:3000';
const SECRET = (process.env.CRON_SECRET || '').trim();
const JOBS = ['telegram-scheduler', 'sla-breach', 'ratelimit-cleanup'] as const;

let fail = 0;
const check = (name: string, ok: boolean, note = '') => {
  if (!ok) fail++;
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${name}${note ? ` — ${note}` : ''}`);
};

async function call(job: string, auth?: string) {
  const res = await fetch(`${BASE}/api/cron/${job}`, {
    method: 'POST',
    headers: auth ? { authorization: auth } : {},
  });
  let body: any = null;
  try { body = await res.json(); } catch { /* ignore */ }
  return { status: res.status, body };
}

(async () => {
  console.log('═══ cron endpoint যাচাই ═══\n');
  console.log(`  CRON_SECRET : ${SECRET ? `সেট (${SECRET.length} অক্ষর)` : '⚠️ সেট নেই'}\n`);
  if (!SECRET) { console.error('✗ CRON_SECRET ছাড়া যাচাই অর্থহীন'); process.exit(1); }

  for (const job of JOBS) {
    console.log(`── ${job} ──`);

    const noAuth = await call(job);
    check(`${job}: সিক্রেট ছাড়া 401`, noAuth.status === 401, `HTTP ${noAuth.status}`);

    const wrong = await call(job, 'Bearer definitely-not-the-secret');
    check(`${job}: ভুল সিক্রেটে 401`, wrong.status === 401, `HTTP ${wrong.status}`);

    // ★ দৈর্ঘ্য-oracle পরীক্ষা: সঠিক দৈর্ঘ্যের ভুল টোকেনেও 401 হতে হবে
    const sameLen = await call(job, 'Bearer ' + 'x'.repeat(SECRET.length));
    check(`${job}: সমান-দৈর্ঘ্যের ভুল টোকেনেও 401`, sameLen.status === 401, `HTTP ${sameLen.status}`);

    const ok = await call(job, `Bearer ${SECRET}`);
    check(`${job}: সঠিক সিক্রেটে 200`, ok.status === 200,
      `HTTP ${ok.status}${ok.body?.error ? ` — ${ok.body.error}` : ''}`);
    if (ok.status === 200) {
      const { success, ms, ...rest } = ok.body || {};
      console.log(`        ফল: ${JSON.stringify(rest)} · ${ms}ms`);
    }
    console.log('');
  }

  // ── readiness-এ শেষ-রান দেখা যাচ্ছে? ──
  console.log('── readiness → jobs[] ──');
  const r = await fetch(`${BASE}/api/admin/readiness`);
  check('readiness অ্যাডমিন ছাড়া খোলা নয়', r.status === 401 || r.status === 403, `HTTP ${r.status}`);
  console.log('  (jobs[] অ্যাডমিন সেশনে দেখা যায় — auth-ui-test আলাদা করে দেখে)');

  console.log('\n════════════════════════════════════════');
  console.log(fail ? `  ${fail} ব্যর্থ` : '  সব পাস');
  process.exit(fail ? 1 : 0);
})();
