/**
 * ═══════════════════════════════════════════════════════════
 * ★★★ `npm test` — স্কিমা push করে তারপর Vitest (Group D)
 *
 *   ধাপ:
 *     ১. টেস্ট URL গার্ড (localhost + `_test`)
 *     ২. ডকার কনটেইনার সাড়া দিচ্ছে কিনা — না দিলে **পরিষ্কার
 *        নির্দেশনা** দিয়ে থামে (নীরবে skip নয়)
 *     ৩. `prisma db push` — কেবল টেস্ট URL দিয়ে
 *     ৪. `vitest run`
 *
 *   ⚠️ প্রোডাকশন `DATABASE_URL` সাব-প্রসেসে **পাঠানো হয় না** —
 *      ভুল করেও prisma সেটিতে push করতে পারবে না।
 * ═══════════════════════════════════════════════════════════
 */
import { spawnSync } from 'node:child_process';
import net from 'node:net';

const TEST_URL =
  process.env.TEST_DATABASE_URL ||
  'postgresql://test:test@localhost:5433/uidtopup_test';

// ── ১. গার্ড ──
const u = new URL(TEST_URL);
const host = u.hostname;
const name = u.pathname.replace(/^\//, '');
if (!['localhost', '127.0.0.1', '::1', 'test-db'].includes(host) || !name.endsWith('_test')) {
  console.error(
    `\n✗ থামানো হলো — টেস্ট ডাটাবেস অবশ্যই localhost-এ ও নাম "_test" দিয়ে শেষ হতে হবে।\n` +
    `  পাওয়া গেছে: host=${host} db=${name}\n` +
    `  লাইভ Neon-এ টেস্ট চালানো নিষিদ্ধ (CLAUDE.md §2.1)।\n`,
  );
  process.exit(1);
}

// ── ২. কনটেইনার চালু আছে? ──
const reachable = await new Promise((resolve) => {
  const s = net.createConnection({ host: host === '::1' ? '127.0.0.1' : host, port: Number(u.port || 5432) });
  const done = (ok) => { s.destroy(); resolve(ok); };
  s.setTimeout(3000);
  s.on('connect', () => done(true));
  s.on('error', () => done(false));
  s.on('timeout', () => done(false));
});

if (!reachable) {
  console.error(
    `\n✗ টেস্ট ডাটাবেসে সংযোগ করা যাচ্ছে না (${host}:${u.port}).\n\n` +
    `  চালু করুন:\n    npm run test:db:up\n\n` +
    `  ডকার না থাকলে টেস্ট চালানো যাবে না — এটি ইচ্ছাকৃত।\n` +
    `  লাইভ ডাটাবেসে fallback করা হবে না (CLAUDE.md §2.1)।\n`,
  );
  process.exit(1);
}

const npx = process.platform === 'win32' ? 'npx.cmd' : 'npx';
// ★ প্রোডাকশন DATABASE_URL বাদ দিয়ে পরিবেশ বানাই
const { DATABASE_URL: _prod, ...rest } = process.env;
const env = { ...rest, DATABASE_URL: TEST_URL, TEST_DATABASE_URL: TEST_URL };

// ── ৩. স্কিমা ──
console.log('  prisma db push → টেস্ট ডাটাবেস …');
let r = spawnSync(npx, ['prisma', 'db', 'push', '--skip-generate', '--accept-data-loss'], { stdio: 'inherit', env });
if (r.status !== 0) process.exit(r.status ?? 1);

// ── ৪. টেস্ট ──
r = spawnSync(npx, ['vitest', 'run', ...process.argv.slice(2)], { stdio: 'inherit', env });
process.exit(r.status ?? 1);
