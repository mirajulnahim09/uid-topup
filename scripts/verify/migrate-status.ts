/**
 * ═══════════════════════════════════════════════════════════
 * ★★★ যাচাই — স্থাপনার ডাটাবেসে **সব মাইগ্রেশন প্রয়োগ হয়েছে কি না**
 *
 *   npm run verify:migrate-status
 *   npx tsx scripts/verify/migrate-status.ts
 *
 *   ── কোন বাগটি এটি ধরে ──
 *   ২০২৬-০৮-১১: Group E/F/H এর ৪টি মাইগ্রেশন **টেস্ট DB-তে** প্রয়োগ
 *   হয়েছিল (তাই ১৭১টি টেস্ট সবুজ), কিন্তু **লাইভ Neon-এ নয়**। ফলে
 *   প্রতিটি প্রোডাক্ট পাতা 500 দিচ্ছিল —
 *   `The column Variant.resellerPrice does not exist`।
 *
 *   টেস্ট এটি কখনো ধরতে পারে না: টেস্ট নিজের DB-তে স্কিমা push করে
 *   নেয়, তাই সেখানে drift থাকা অসম্ভব। একমাত্র যে জায়গায় প্রশ্নটি
 *   অর্থবহ, সেটি হলো **স্থাপনার আসল ডাটাবেস**।
 *
 *   ── দুটি স্বাধীন দাবি ──
 *   ১. `migrate status` — `prisma/migrations/` এর প্রতিটি ফোল্ডার
 *      ডাটাবেসের `_prisma_migrations`-এ প্রয়োগ হিসেবে লেখা আছে।
 *   ২. `migrate diff` — ডাটাবেসের **প্রকৃত** স্কিমা ও `schema.prisma`
 *      হুবহু এক (খালি মাইগ্রেশন)। ১ পাস করেও ২ ফেল করতে পারে: কেউ
 *      `db push` করলে বা হাতে কলাম বদলালে ইতিহাস ঠিক থাকে, স্কিমা নয়।
 *
 *   ── কোন URL যাচাই হয় ──
 *   অগ্রাধিকার: `MIGRATE_CHECK_DATABASE_URL` → `.env` এর `DATABASE_URL`
 *   → `process.env.DATABASE_URL`।
 *
 *   ⚠️ `.env` **ফাইল থেকে** পড়া হয় ইচ্ছাকৃতভাবে, `process.env` নয় —
 *   কারণ `.env.development` এখন `DATABASE_URL` কে লোকাল ডেভ DB-তে
 *   override করে। process.env ধরলে এই স্ক্রিপ্ট ডেভ DB যাচাই করত ও
 *   সবসময় সবুজ দেখাত, অর্থাৎ ঠিক যে বাগটি ধরার জন্য লেখা সেটিই
 *   মিস করত।
 *
 *   ⚠️ URL কখনো ছাপা হয় না (CLAUDE.md §2.3) — শুধু হোস্ট ও DB নাম।
 * ═══════════════════════════════════════════════════════════
 */
import { spawnSync } from 'node:child_process';
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';

const require = createRequire(import.meta.url);

let fail = 0;
const check = (name: string, ok: boolean, note = '') => {
  if (!ok) fail++;
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${name}${note ? ` — ${note}` : ''}`);
};

/** ★ `.env` **ফাইল** থেকে সরাসরি — `.env.development` এর override এড়াতে */
function urlFromEnvFile(): string | null {
  if (!existsSync('.env')) return null;
  const line = readFileSync('.env', 'utf8')
    .split(/\r?\n/)
    .find((l) => l.trimStart().startsWith('DATABASE_URL='));
  if (!line) return null;
  return line.slice(line.indexOf('=') + 1).trim().replace(/^["']|["']$/g, '') || null;
}

function resolveUrl(): { url: string; source: string } | null {
  const explicit = process.env.MIGRATE_CHECK_DATABASE_URL?.trim();
  if (explicit) return { url: explicit, source: 'MIGRATE_CHECK_DATABASE_URL' };
  const fromFile = urlFromEnvFile();
  if (fromFile) return { url: fromFile, source: '.env (DATABASE_URL)' };
  const ambient = process.env.DATABASE_URL?.trim();
  if (ambient) return { url: ambient, source: 'process.env.DATABASE_URL' };
  return null;
}

/** ★ prisma CLI — শেল ছাড়া, সরাসরি entry (উইন্ডোজে npx shim ভাঙে) */
function prismaEntry(): string {
  const pj = require('prisma/package.json');
  const rel = typeof pj.bin === 'string' ? pj.bin : pj.bin.prisma;
  return require.resolve(`prisma/${rel.replace(/^\.\//, '')}`);
}

function runPrisma(args: string[], url: string) {
  const r = spawnSync(process.execPath, [prismaEntry(), ...args], {
    encoding: 'utf8',
    env: { ...process.env, DATABASE_URL: url },
    maxBuffer: 16 * 1024 * 1024,
  });
  return { status: r.status ?? 1, out: `${r.stdout ?? ''}${r.stderr ?? ''}` };
}

console.log('═══ যাচাই — স্থাপনার DB-তে মাইগ্রেশন সম্পূর্ণ প্রয়োগ ═══\n');

const resolved = resolveUrl();
if (!resolved) {
  console.error(
    '\n✗ কোনো ডাটাবেস URL পাওয়া যায়নি।\n\n' +
      '  CI-তে গোপন মানটি দিন:\n' +
      '    MIGRATE_CHECK_DATABASE_URL: ${{ secrets.PRODUCTION_DATABASE_URL }}\n\n' +
      '  ⚠️ এই যাচাই নীরবে skip করা হয় না — যে বাগটি ধরার জন্য এটি লেখা,\n' +
      '     সেটি ঠিক তখনই ঘটে যখন কেউ ধরে নেয় "নিশ্চয়ই প্রয়োগ হয়েছে"।\n',
  );
  process.exit(1);
}

const { url, source } = resolved;

// ★ পরিচয় ছাপি, কিন্তু credential কখনো নয়
{
  const u = new URL(url);
  const dbName = u.pathname.slice(1).split('?')[0];
  const local = ['localhost', '127.0.0.1'].includes(u.hostname);
  console.log(`  উৎস     : ${source}`);
  console.log(`  ডাটাবেস  : ${dbName}`);
  console.log(`  অবস্থান  : ${local ? 'localhost' : 'remote'}\n`);

  // ⚠️ লোকাল DB যাচাই করা মানে কার্যত কিছুই যাচাই না হওয়া — সতর্ক করি
  if (local && source !== 'MIGRATE_CHECK_DATABASE_URL') {
    console.log(
      '  ⚠️  লক্ষ্য localhost। এটি স্থাপনার ডাটাবেস নয়, তাই এই রান\n' +
        '      প্রকৃত drift ধরবে না। CI-তে আসল URL দিন।\n',
    );
  }
}

// ── দাবি ১: প্রতিটি মাইগ্রেশন প্রয়োগ হয়েছে ──
const localCount = existsSync('prisma/migrations')
  ? readdirSync('prisma/migrations', { withFileTypes: true }).filter((d) => d.isDirectory()).length
  : 0;

const status = runPrisma(['migrate', 'status'], url);
const pending = /have not yet been applied|not yet been applied/i.test(status.out);
const upToDate = /Database schema is up to date/i.test(status.out);

check(
  `${localCount}টি মাইগ্রেশনের সবগুলো প্রয়োগ হয়েছে`,
  status.status === 0 && upToDate && !pending,
  pending
    ? 'কিছু মাইগ্রেশন **বাকি** — `npx prisma migrate deploy` চালান'
    : status.status !== 0
      ? 'prisma migrate status ব্যর্থ (সংযোগ?)'
      : '',
);

// ── দাবি ২: প্রকৃত স্কিমা ও schema.prisma এক ──
const diff = runPrisma(
  ['migrate', 'diff', '--from-schema-datasource', 'prisma/schema.prisma', '--to-schema-datamodel', 'prisma/schema.prisma', '--script'],
  url,
);
const empty = /This is an empty migration/i.test(diff.out);
check(
  'ডাটাবেসের স্কিমা ও schema.prisma-তে কোনো drift নেই',
  diff.status === 0 && empty,
  empty ? '' : 'drift আছে — নিচে প্রয়োজনীয় SQL',
);

// ── ব্যর্থ হলে প্রকৃত কারণটি দেখাই ──
if (fail > 0) {
  if (pending || status.status !== 0) {
    console.log('\n── prisma migrate status ──');
    console.log(status.out.split('\n').filter((l) => !/ at "| at localhost/.test(l)).join('\n').trim());
  }
  if (!empty) {
    console.log('\n── drift (প্রয়োগ করলে DB schema.prisma-র সমান হতো) ──');
    console.log(diff.out.trim().slice(0, 4000));
  }
  console.log(
    '\n✗ স্থাপনার ডাটাবেস কোডের সাথে মেলে না।\n' +
      '  এটিই সেই শ্রেণির বাগ যা টেস্টে ধরা পড়ে না — টেস্ট নিজের DB-তে\n' +
      '  স্কিমা push করে নেয়, তাই সেখানে drift থাকতেই পারে না।\n',
  );
  process.exit(1);
}

console.log('\n✓ স্থাপনার ডাটাবেস কোডের সাথে সম্পূর্ণ সঙ্গতিপূর্ণ।');
