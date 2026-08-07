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
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

/**
 * ★ প্যাকেজের আসল JS এন্ট্রি বের করি — `npx`/`.bin` shim নয়।
 *
 *   ⚠️ কেন: Node 20.12+/22+ এ নিরাপত্তা সংশোধনের (CVE-2024-27980) পর
 *   উইন্ডোজে `spawnSync('npx.cmd', …)` `shell:true` ছাড়া **EINVAL**
 *   দিয়ে ব্যর্থ হয় — stdout/stderr দুটোই ফাঁকা থাকে। ফলে হারনেস
 *   নীরবে exit 1 করত আর মনে হতো টেস্ট চলেছে কিন্তু কিছু ছাপেনি।
 *
 *   `shell:true` দিলে সমস্যা মিটত, কিন্তু তখন আর্গুমেন্ট শেল-এর
 *   হাতে পড়ে (কোটিং/ইনজেকশন ঝুঁকি)। তাই সরাসরি `process.execPath`
 *   দিয়ে প্যাকেজের entry চালাই — কোনো শেল নেই, প্ল্যাটফর্ম-নিরপেক্ষ।
 */
function binEntry(pkg) {
  const pj = require(`${pkg}/package.json`);
  const rel = typeof pj.bin === 'string' ? pj.bin : pj.bin[pkg];
  return require.resolve(`${pkg}/${rel.replace(/^\.\//, '')}`);
}

/** ★ node দিয়ে সরাসরি চালানো — ব্যর্থ হলে কারণসহ থামে (নীরব exit নয়) */
function runNode(entry, args, env, label) {
  const r = spawnSync(process.execPath, [entry, ...args], { stdio: 'inherit', env });
  if (r.error) {
    console.error(`\n✗ ${label} চালু করা যায়নি: ${r.error.message}\n`);
    process.exit(1);
  }
  return r.status ?? 1;
}

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

// ★ প্রোডাকশন DATABASE_URL বাদ দিয়ে পরিবেশ বানাই
const { DATABASE_URL: _prod, ...rest } = process.env;
const env = { ...rest, DATABASE_URL: TEST_URL, TEST_DATABASE_URL: TEST_URL };

// ── ৩. স্কিমা ──
console.log('  prisma db push → টেস্ট ডাটাবেস …');
const push = runNode(
  binEntry('prisma'),
  ['db', 'push', '--skip-generate', '--accept-data-loss'],
  env,
  'prisma',
);
if (push !== 0) process.exit(push);

// ── ৪. টেস্ট ──
process.exit(runNode(binEntry('vitest'), ['run', ...process.argv.slice(2)], env, 'vitest'));
