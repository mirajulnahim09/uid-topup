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

function runPrismaOnce(args: string[], url: string) {
  const r = spawnSync(process.execPath, [prismaEntry(), ...args], {
    encoding: 'utf8',
    // ★ `directUrl` — migrate CLI এটিই ব্যবহার করে। `MIGRATE_CHECK_DIRECT_URL` (non-pooler)
    //   থাকলে সেটি, নাহলে একই URL (pooler-এ `migrate status` সাধারণত চলে, কিন্তু নিশ্চিত নয়)।
    env: { ...process.env, DATABASE_URL: url, DIRECT_URL: process.env.MIGRATE_CHECK_DIRECT_URL?.trim() || url },
    maxBuffer: 16 * 1024 * 1024,
  });
  return { status: r.status ?? 1, out: `${r.stdout ?? ''}${r.stderr ?? ''}` };
}

/**
 * ★★★ Neon auto-suspend এর জন্য retry।
 *
 *   ⚠️ কেন দরকার (মাপা, অনুমান নয়): মাইগ্রেশন প্রয়োগের ঠিক পরেই এই
 *   স্ক্রিপ্ট `P1001: Can't reach database server` দিয়ে ব্যর্থ হয়েছিল —
 *   ডাটাবেস ঠিকই ছিল, কেবল Neon-এর কম্পিউট আবার ঘুমিয়ে পড়েছিল
 *   (CLAUDE.md §1: auto-suspend চালু)।
 *
 *   ⚠️ এটি না থাকলে CI-র `migrate-guard` মাঝেমধ্যে **মিথ্যা লাল**
 *   দেখাত — আর একটি গার্ড যা কারণ ছাড়াই লাল হয়, সেটিকে মানুষ
 *   উপেক্ষা করতে শেখে। তখন আসল drift-ও চোখ এড়িয়ে যেত।
 *
 *   ⚠️ কেবল **সংযোগ-ব্যর্থতা** retry হয়। প্রকৃত drift বা বাকি
 *   মাইগ্রেশন কখনো retry হয় না — সেগুলো প্রথমবারেই সত্য।
 */
const CONNECTION_ERROR = /P1001|Can't reach database server|ECONNRESET|ETIMEDOUT|unexpected eof/i;

/**
 * ⚠️ **বাজেট বাড়ানো হয়েছে — মাপা কারণে (২০২৬-০৮-২৮)।**
 *
 *   আগে ছিল ৩ চেষ্টা × ৪s = ~১২s অপেক্ষা। সম্পূর্ণ ঘুমন্ত Neon
 *   কম্পিউটের জন্য সেটি কম: ঐ দিনের রানে দাবি ১ তিনবারই
 *   `P1001` খেয়ে **FAIL** দিল, অথচ ঠিক পরের দাবি (`migrate diff`)
 *   একই ডাটাবেসে **সফলভাবে** যুক্ত হয়ে "কোনো drift নেই" বলল —
 *   অর্থাৎ ইতিমধ্যে DB জেগে গিয়েছিল। এক রিপোর্টে দুটি পরস্পরবিরোধী
 *   কথা, আর লালটি ছিল **মিথ্যা** (পরে চালিয়ে ১২/১২ পাস, drift শূন্য)।
 *
 *   এটি ঠিক সেই ফাঁদ যার কথা উপরে লেখা আছে: কারণ ছাড়া লাল হওয়া
 *   গার্ডকে মানুষ উপেক্ষা করতে শেখে। তাই এখন ৫ চেষ্টা, আর বিরতি
 *   ক্রমবর্ধমান (৪ → ৮ → ১২ → ১৬s, মোট ~৪০s) — cold start এর জন্য
 *   যথেষ্ট, অথচ প্রকৃত ডাউনটাইমে অসীম নয়।
 */
function runPrisma(args: string[], url: string, attempts = 5) {
  let last = runPrismaOnce(args, url);
  for (let i = 2; i <= attempts && last.status !== 0 && CONNECTION_ERROR.test(last.out); i++) {
    const waitMs = (i - 1) * 4000;
    console.log(`  ↻ সংযোগ ব্যর্থ (Neon জেগে উঠছে?) — চেষ্টা ${i}/${attempts}, ${waitMs / 1000}s অপেক্ষা …`);
    spawnSync(process.execPath, ['-e', `setTimeout(()=>{},${waitMs})`]);
    last = runPrismaOnce(args, url);
  }
  return last;
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

let status = runPrisma(['migrate', 'status'], url);

// ── দাবি ২: প্রকৃত স্কিমা ও schema.prisma এক ──
const diff = runPrisma(
  ['migrate', 'diff', '--from-schema-datasource', 'prisma/schema.prisma', '--to-schema-datamodel', 'prisma/schema.prisma', '--script'],
  url,
);

/**
 * ★★★ দুটি দাবির **পরস্পরবিরোধ** মিটিয়ে নেওয়া।
 *
 *   `diff` সফল হওয়ার অর্থ ডাটাবেসে যুক্ত হওয়া **গেছে**। তাই তার
 *   আগে `status` যদি কেবল সংযোগ-ব্যর্থতায় পড়ে থাকে, সেটি নিশ্চিতভাবে
 *   বাসি — DB ইতিমধ্যে জেগে গেছে। আগে এই অবস্থায় রিপোর্টে একই সাথে
 *   "সংযোগ ব্যর্থ" ও "কোনো drift নেই" লেখা থাকত, আর পাঠকের পক্ষে
 *   কোনটি সত্য তা বোঝার উপায় ছিল না (২০২৬-০৮-২৮ এ ঘটেছিল)।
 *
 *   ⚠️ কেবল **সংযোগ**-ব্যর্থতাই এভাবে পুনর্বিবেচিত হয়। বাকি
 *   মাইগ্রেশন বা প্রকৃত drift কখনোই নয় — সেগুলো প্রথমবারেই সত্য।
 */
if (status.status !== 0 && CONNECTION_ERROR.test(status.out) && diff.status === 0) {
  console.log('  ↻ diff যুক্ত হতে পেরেছে — status আবার একবার চালাই (DB জেগে গেছে) …');
  status = runPrisma(['migrate', 'status'], url);
}

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

const empty = /This is an empty migration/i.test(diff.out);
check(
  'ডাটাবেসের স্কিমা ও schema.prisma-তে কোনো drift নেই',
  diff.status === 0 && empty,
  diff.status !== 0
    ? 'prisma migrate diff ব্যর্থ (সংযোগ?) — drift যাচাই করাই যায়নি'
    : empty
      ? ''
      : 'drift আছে — নিচে প্রয়োজনীয় SQL',
);

/**
 * ★ Prisma-র সংযোগ-ত্রুটিতে ডাটাবেস-হোস্ট থাকে (`Can't reach database server at
 *   \`ep-…neon.tech:5432\``) — CI-লগ প্রায়ই অনেকে দেখেন। পরিচয় ছাপার নিয়ম
 *   (উপরে "credential কখনো নয়") ত্রুটি-বার্তাতেও মানা হয়। (চূড়ান্ত অডিটে
 *   এই স্ক্রিপ্টই টার্মিনালে লাইভ হোস্টনাম ছেপেছিল।)
 */
const redactHost = (s: string) => {
  const host = new URL(url).hostname;
  return host ? s.split(host).join('<db-host>') : s;
};

// ── ব্যর্থ হলে প্রকৃত কারণটি দেখাই ──
if (fail > 0) {
  if (pending || status.status !== 0) {
    console.log('\n── prisma migrate status ──');
    console.log(redactHost(status.out.split('\n').filter((l) => !/ at "| at localhost/.test(l)).join('\n').trim()));
  }
  /** ⚠️ diff **চলতেই পারেনি** হলে এটি drift নয়, সংযোগ-ব্যর্থতা — আলাদা শিরোনাম */
  if (diff.status !== 0) {
    console.log('\n── prisma migrate diff ব্যর্থ ──');
    console.log(redactHost(diff.out.trim().slice(0, 2000)));
  } else if (!empty) {
    console.log('\n── drift (প্রয়োগ করলে DB schema.prisma-র সমান হতো) ──');
    console.log(diff.out.trim().slice(0, 4000));
  }

  /**
   * ⚠️ যুক্ত হওয়াই যায়নি বনাম যুক্ত হয়ে অমিল পাওয়া — দুটি ভিন্ন কথা।
   *   আগে দুই ক্ষেত্রেই "ডাটাবেস কোডের সাথে মেলে না" ছাপা হতো, যা
   *   সংযোগ-ব্যর্থতার সময় একটি **দাবি** করত যা মাপাই হয়নি।
   */
  const unreachable =
    (status.status !== 0 && CONNECTION_ERROR.test(status.out)) ||
    (diff.status !== 0 && CONNECTION_ERROR.test(diff.out));

  console.log(
    unreachable
      ? '\n✗ স্থাপনার ডাটাবেসে যুক্তই হওয়া গেল না — তাই মিল/অমিল কিছুই\n' +
        '  যাচাই হয়নি। Neon ঘুমিয়ে থাকলে আবার চালান; বারবার হলে\n' +
        '  ডাটাবেসের অবস্থা দেখুন।\n'
      : '\n✗ স্থাপনার ডাটাবেস কোডের সাথে মেলে না।\n' +
        '  এটিই সেই শ্রেণির বাগ যা টেস্টে ধরা পড়ে না — টেস্ট নিজের DB-তে\n' +
        '  স্কিমা push করে নেয়, তাই সেখানে drift থাকতেই পারে না।\n',
  );
  process.exit(1);
}

console.log('\n✓ স্থাপনার ডাটাবেস কোডের সাথে সম্পূর্ণ সঙ্গতিপূর্ণ।');
