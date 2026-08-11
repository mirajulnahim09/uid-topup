/**
 * ═══════════════════════════════════════════════════════════
 * ★★★ ডেভ ডাটাবেসে ডেমো ডেটা — `npm run dev:db:seed`
 *
 *   ⚠️⚠️ কেন আলাদা স্ক্রিপ্ট, `npm run db:seed` নয়:
 *   `db:seed` = `tsx prisma/seed.ts`, আর `prisma/seed.ts` কোনো URL
 *   স্পষ্ট করে না — `new PrismaClient()` লেখে। Prisma Client নিজে
 *   `.env` পড়ে, আর `.env` এর `DATABASE_URL` **লাইভ Neon**। অর্থাৎ
 *   `npm run db:seed` চালালে সেটি প্রোডাকশনে seed করত।
 *   (`.env.development` এখানে কাজে আসে না — সেটি কেবল Next.js পড়ে,
 *    Prisma CLI বা tsx পড়ে না।)
 *
 *   এই র‍্যাপারটি `DATABASE_URL` **স্পষ্ট করে** ডেভ DB-তে বেঁধে দেয়
 *   এবং প্রোডাকশনের মানটি সাব-প্রসেসে পাঠায়ই না — ঠিক যেভাবে
 *   `scripts/test-run.mjs` টেস্টের জন্য করে।
 * ═══════════════════════════════════════════════════════════
 */
import { spawnSync } from 'node:child_process';
import net from 'node:net';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const DEV_URL = 'postgresql://dev:dev@localhost:5434/uidtopup_dev';

// ── গার্ড: localhost ও `_dev` ছাড়া কিছুতেই নয় ──
const u = new URL(DEV_URL);
if (!['localhost', '127.0.0.1'].includes(u.hostname) || !u.pathname.endsWith('_dev')) {
  console.error('\n✗ থামানো হলো — ডেভ URL localhost/_dev নয়।\n');
  process.exit(1);
}

// ── কনটেইনার চালু আছে? ──
const reachable = await new Promise((resolve) => {
  const s = net.createConnection({ host: u.hostname, port: Number(u.port) });
  const done = (ok) => { s.destroy(); resolve(ok); };
  s.setTimeout(3000);
  s.on('connect', () => done(true));
  s.on('error', () => done(false));
  s.on('timeout', () => done(false));
});
if (!reachable) {
  console.error(
    `\n✗ ডেভ ডাটাবেসে সংযোগ করা যাচ্ছে না (${u.hostname}:${u.port}).\n\n` +
    `  চালু করুন:\n    npm run dev:db:up\n    npm run dev:db:sync\n`,
  );
  process.exit(1);
}

// ★ প্রোডাকশন URL সাব-প্রসেসে **পাঠাই না**
const { DATABASE_URL: _prod, ...rest } = process.env;
const env = { ...rest, DATABASE_URL: DEV_URL };

const tsx = require.resolve('tsx/cli');
const r = spawnSync(process.execPath, [tsx, 'prisma/seed.ts'], { stdio: 'inherit', env });
process.exit(r.status ?? 1);
