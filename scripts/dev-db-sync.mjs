/**
 * ═══════════════════════════════════════════════════════════
 * ★★★ প্রোডাকশনের **স্কিমা** ডেভ ডাটাবেসে আনা — ডেটা কখনো নয়
 *
 *   npm run dev:db:sync
 *
 *   ── কেন ──
 *   `.env` এর `DATABASE_URL` লাইভ Neon-এ যায়। ফলে `npm run dev` চালালে
 *   ব্রাউজারে প্রতিটি ক্লিক আসল গ্রাহকের ডেটায় লিখত, আর ডেভ-প্রোড এক
 *   হওয়ায় স্কিমা drift দেখার কোনো উপায়ই ছিল না — Group E/F/H এর
 *   মাইগ্রেশন-ফাঁক ঠিক এভাবেই লুকিয়ে ছিল।
 *
 *   ── কী করে ──
 *   ১. প্রোডাকশন থেকে `pg_dump --schema-only` (কোনো সারি নয়)
 *   ২. সঙ্গে **শুধু** `_prisma_migrations` টেবিলের **ডেটা** — নাহলে
 *      লোকাল DB-তে মাইগ্রেশন ইতিহাস ফাঁকা থাকত ও `migrate status`
 *      মিথ্যা করে "৯টি বাকি" দেখাত।
 *   ৩. ডেভ DB-র `public` স্কিমা নতুন করে বানিয়ে দুটোই লোড
 *   ৪. `prisma migrate status` দিয়ে নিজেকে যাচাই
 *
 *   ⚠️ `--schema-only` মানে **একটি সারিও** কপি হয় না — গ্রাহক, অর্ডার,
 *      খতিয়ান, কিছুই না। ডেভে ডেটা লাগলে `npm run db:seed`।
 *
 *   ⚠️ কেন `prisma migrate deploy` দিয়ে স্কিমা বানাই না: প্রোডাকশনে
 *      `prisma/apply-constraints.ts` মাইগ্রেশনের **বাইরে** কিছু CHECK
 *      constraint বসায়। ডাম্প সেগুলোও ধরে; `migrate deploy` ধরত না।
 *      অর্থাৎ ডাম্পই প্রোডাকশনের সত্যিকারের প্রতিচ্ছবি।
 *
 *   ⚠️ pg_dump/psql হোস্টে ইনস্টল করা নেই ধরে নিয়ে সবকিছু
 *      `postgres:18` কনটেইনারে চলে — **ঠিক Neon-এর ভার্সন** (18.4)।
 *      pg_dump কখনো নিজের চেয়ে নতুন সার্ভার ডাম্প করতে পারে না।
 *
 *   ⚠️ কোনো ভলিউম mount নেই — SQL stdin/stdout দিয়ে যায়। উইন্ডোজে
 *      পাথ-রূপান্তরের ঝামেলা এড়াতে।
 * ═══════════════════════════════════════════════════════════
 */
import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';

const PG_IMAGE = 'postgres:18';
const DEV_URL = 'postgresql://dev:dev@localhost:5434/uidtopup_dev';
/** ★ কনটেইনারের ভেতর থেকে হোস্টের 5434 পোর্ট */
const DEV_URL_FROM_CONTAINER = 'postgresql://dev:dev@host.docker.internal:5434/uidtopup_dev';

const die = (msg) => {
  console.error(`\n✗ ${msg}\n`);
  process.exit(1);
};

/**
 * ★ প্রোডাকশন URL **সরাসরি `.env` থেকে** পড়ি, `process.env` থেকে নয়।
 *
 *   ⚠️ কারণ: `.env.development` এখন `DATABASE_URL` কে ডেভ DB-তে
 *   override করে। `process.env` পড়লে এই স্ক্রিপ্ট ডেভ DB থেকেই ডেভ
 *   DB-তে ডাম্প করত — অর্থাৎ চুপচাপ কিছুই করত না।
 */
function readProdUrl() {
  if (!existsSync('.env')) die('`.env` পাওয়া যায়নি — প্রোডাকশন URL কোথা থেকে নেব?');
  const line = readFileSync('.env', 'utf8')
    .split(/\r?\n/)
    .find((l) => l.trimStart().startsWith('DATABASE_URL='));
  if (!line) die('`.env` তে `DATABASE_URL` নেই।');
  const raw = line.slice(line.indexOf('=') + 1).trim().replace(/^["']|["']$/g, '');
  if (!/^postgres(ql)?:\/\//.test(raw)) die('`.env` এর `DATABASE_URL` postgresql:// দিয়ে শুরু হয় না।');
  return raw;
}

/** ★ docker চালানো। `input` থাকলে stdin দিয়ে যায়; secret কখনো argv-তে নয়। */
function docker(args, { input, capture, label, throwOnFail } = {}) {
  const r = spawnSync('docker', args, {
    input,
    encoding: 'utf8',
    stdio: input !== undefined || capture ? ['pipe', 'pipe', 'pipe'] : 'inherit',
    maxBuffer: 64 * 1024 * 1024,
  });
  if (r.error) die(`docker চালানো গেল না (${label}): ${r.error.message}`);
  if (r.status !== 0) {
    // ⚠️ stderr ছাপি, কিন্তু URL কখনো এতে থাকে না — pg_dump তা ছাপে না
    const msg = `${label} ব্যর্থ (exit ${r.status}):\n${(r.stderr || '').trim()}`;
    // ★ retry-যোগ্য কলার নিজে সামলাবে; বাকিরা সাথে সাথেই থামে
    if (throwOnFail) throw new Error(msg);
    die(msg);
  }
  return r.stdout ?? '';
}

/** ★ URL সবসময় env দিয়ে যায় — argv-তে দিলে `docker ps`/হিস্টরিতে দেখা যেত */
function pgRun(url, shellCmd, opts = {}) {
  return docker(
    ['run', '--rm', '-i', '-e', `PGURL=${url}`, '--add-host', 'host.docker.internal:host-gateway', PG_IMAGE, 'sh', '-c', shellCmd],
    opts,
  );
}

/**
 * ★★★ Neon-এর জন্য retry।
 *
 *   ⚠️ Neon-এ **auto-suspend** চালু (CLAUDE.md §1)। বসে থাকা কম্পিউট
 *   জেগে ওঠার সময় প্রথম সংযোগটি মাঝপথে কাটা পড়তে পারে —
 *   `SSL error: unexpected eof while reading`। বাস্তবে এটি এই
 *   স্ক্রিপ্টেই একবার ঘটেছে, তৃতীয় ধাপে।
 *
 *   ⚠️ কেবল ডাম্প (পড়া) retry হয়, লেখা নয় — পড়া idempotent।
 */
function pgRunRetry(url, shellCmd, opts = {}, attempts = 3) {
  let last;
  for (let i = 1; i <= attempts; i++) {
    try {
      return pgRun(url, shellCmd, { ...opts, throwOnFail: true });
    } catch (e) {
      last = e;
      if (i < attempts) {
        console.log(`       ↻ চেষ্টা ${i} ব্যর্থ (Neon জেগে উঠছে?) — আবার চেষ্টা …`);
        spawnSync(process.execPath, ['-e', 'setTimeout(()=>{},3000)']); // ~3s বিরতি
      }
    }
  }
  die(`${opts.label} — ${attempts}টি চেষ্টাতেও ব্যর্থ:\n${last?.message ?? ''}`);
}

console.log('═══ ডেভ ডাটাবেসে প্রোডাকশনের স্কিমা আনা ═══\n');

const PROD_URL = readProdUrl();

// ── ০. গার্ড: লক্ষ্য অবশ্যই localhost ──
{
  const t = new URL(DEV_URL);
  if (!['localhost', '127.0.0.1'].includes(t.hostname) || !t.pathname.endsWith('_dev')) {
    die('ডেভ URL localhost/_dev নয় — থামানো হলো।');
  }
  const p = new URL(PROD_URL);
  if (p.hostname === t.hostname) {
    die('প্রোডাকশন ও ডেভ URL একই হোস্টে — থামানো হলো।');
  }
}

// ── ১. ডেভ কনটেইনার সাড়া দিচ্ছে? ──
console.log('  ১/৫  ডেভ কনটেইনার যাচাই …');
{
  const r = spawnSync('docker', ['inspect', '-f', '{{.State.Running}}', 'uidtopup-dev-db'], { encoding: 'utf8' });
  if (r.status !== 0 || (r.stdout || '').trim() !== 'true') {
    die('ডেভ ডাটাবেস চলছে না।\n  চালু করুন:  npm run dev:db:up');
  }
}

// ── ২. প্রোডাকশনের স্কিমা ডাম্প (কোনো সারি নয়) ──
console.log('  ২/৫  প্রোডাকশন স্কিমা ডাম্প (--schema-only, ০ সারি) …');
const schemaSql = pgRunRetry(
  PROD_URL,
  // ⚠️ `--no-owner --no-privileges` — Neon-এর role লোকালে নেই
  // ⚠️ `--schema=public` — Neon-এর অভ্যন্তরীণ স্কিমা বাদ
  'pg_dump "$PGURL" --schema-only --no-owner --no-privileges --no-tablespaces --schema=public',
  { capture: true, label: 'pg_dump (schema)' },
);
if (!/CREATE TABLE/i.test(schemaSql)) die('ডাম্পে কোনো টেবিল নেই — কিছু একটা ভুল।');

// ── ৩. মাইগ্রেশন ইতিহাস (শুধু এই একটি টেবিলের ডেটা) ──
console.log('  ৩/৫  মাইগ্রেশন ইতিহাস ডাম্প (_prisma_migrations) …');
const historySql = pgRunRetry(
  PROD_URL,
  'pg_dump "$PGURL" --data-only --no-owner --no-privileges --table=public._prisma_migrations',
  { capture: true, label: 'pg_dump (_prisma_migrations)' },
);

// ── ৪. ডেভ DB নতুন করে বানিয়ে লোড ──
console.log('  ৪/৫  ডেভ স্কিমা নতুন করে তৈরি ও লোড …');
pgRun(
  DEV_URL_FROM_CONTAINER,
  'psql "$PGURL" -v ON_ERROR_STOP=1 -q',
  {
    // ⚠️ শুধু **drop** — `CREATE SCHEMA public` এখানে করি না।
    //   PG 15+ এর ডাম্প নিজেই সেটি লেখে, তাই আগে বানালে
    //   `ERROR: schema "public" already exists` হতো।
    input: 'DROP SCHEMA IF EXISTS public CASCADE;\n',
    label: 'psql (reset schema)',
  },
);
pgRun(DEV_URL_FROM_CONTAINER, 'psql "$PGURL" -v ON_ERROR_STOP=1 -q', {
  // ★ ডাম্প নিজে স্কিমা না বানালে (পুরনো pg_dump) আমরা বানাই
  input: /CREATE SCHEMA public;/i.test(schemaSql) ? schemaSql : `CREATE SCHEMA public;\n${schemaSql}`,
  label: 'psql (load schema)',
});
pgRun(DEV_URL_FROM_CONTAINER, 'psql "$PGURL" -v ON_ERROR_STOP=1 -q', {
  input: historySql,
  label: 'psql (load migration history)',
});

// ── ৫. `.env.development` লিখি ──
console.log('  ৫/৫  .env.development লেখা …');
const ENV_DEV = `# ═══════════════════════════════════════════════════════════
# ★★★ ডেভেলপমেন্ট override — \`scripts/dev-db-sync.mjs\` এটি তৈরি করে
#
#   ⚠️ হাতে বদলাবেন না; \`npm run dev:db:sync\` আবার লিখে দেবে।
#
#   Next.js \`next dev\`-এ এই ফাইলটি \`.env\` এর **উপরে** বসে।
#   (\`@next/env\` আগে-সেট মান overwrite করে না, আর এই ফাইলটি আগে
#    পড়া হয় — তাই এখানকার মানই জেতে, **খালি মানও**। মাপা হয়েছে।)
#
#   ⚠️ Prisma CLI এই ফাইল **পড়ে না** — সে শুধু \`.env\` দেখে। তাই
#   \`npx prisma studio\` ইত্যাদি এখনো প্রোডাকশনে যাবে। ডেভ DB-তে
#   চালাতে npm script গুলো ব্যবহার করুন (dev:db:*), যেগুলো URL
#   স্পষ্ট করে দেয়।
# ═══════════════════════════════════════════════════════════

# ── ডাটাবেস ──
DATABASE_URL="${DEV_URL}"

# ═══════════════════════════════════════════════════════════
# ★★★ বাইরের সার্ভিস — ডেভে সব **বন্ধ**
#
#   ⚠️ কেন খালি করা, ভুয়া মান নয়: প্রতিটি ইন্টিগ্রেশন ইতিমধ্যেই
#   "কী নেই ⇒ ফিচার নীরবে বন্ধ" ধরে লেখা। ভুয়া টোকেন দিলে কোড
#   আসল কল করার **চেষ্টা** করত ও 401 নিয়ে ফিরত — অর্থাৎ ডেভে
#   অকারণ ত্রুটি, আর কোনো বাড়তি নিরাপত্তা নয়।
#
#   ⚠️ এগুলো লাইভ রাখা ডাটাবেস লাইভ রাখারই মতো, শুধু আরও নীরব:
#   একটি ভুল ইমেইল আসল গ্রাহকের ইনবক্সে যায়, একটি টেস্ট অর্ডার
#   আসল অ্যাডমিন-চ্যাটে বাজে, আর একটি আপলোড প্রোডাকশন CDN-এ
#   চিরকাল থেকে যায় — কোনোটিই ডেভ কনসোলে ধরা পড়ে না।
# ═══════════════════════════════════════════════════════════

# ইমেইল (Resend) → \`src/lib/email.ts\` কী না থাকলে skip করে ও warn লেখে
RESEND_API_KEY=

# টেলিগ্রাম → \`envBot()\` null ফেরে, কোনো বার্তা যায় না।
#   ⚠️ DB-তে বট সেট করা থাকলে **DB জেতে** (store.ts: DB > env)।
#      ডেভ DB-তে সেটি ডেভের নিজের বট হবে, প্রোডাকশনেরটি নয়।
TELEGRAM_BOT_TOKEN=
TELEGRAM_CHAT_ID=

# ফাইল আপলোড → লোকাল ডিস্কে (\`public/uploads/\`, gitignored)।
#   দুটোই দরকার: টোকেন খালি **এবং** ড্রাইভার স্পষ্ট, নাহলে
#   getStorage() এর fallback যুক্তির উপর নির্ভর করতে হতো।
BLOB_READ_WRITE_TOKEN=
STORAGE_DRIVER=local

# ═══════════════════════════════════════════════════════════
# ⚠️ যা ইচ্ছাকৃতভাবে override করা **হয়নি**
#
#   · GOOGLE_CLIENT_ID/SECRET — শুধু লগইন যাচাই করে, বাইরে কিছু
#     লেখে না; সরালে ডেভে Google লগইন পরীক্ষা করাই যেত না।
#   · FF_LOOKUP_API_KEY — বাইরের API, কিন্তু **পড়া**, লেখা নয়।
#     (কোটা খরচ হয়; UID-যাচাই পরীক্ষা করতে হলে দরকার।)
#   · TELEGRAM_ENC_KEY — DB-তে রাখা টোকেন খোলার চাবি, বাইরের
#     সার্ভিস নয়। বদলালে ডেভে অকারণ decrypt ব্যর্থতা হতো।
#   · CRON_SECRET, NEXTAUTH_SECRET — স্থানীয়, বাইরে যায় না।
# ═══════════════════════════════════════════════════════════
`;
writeFileSync('.env.development', ENV_DEV);

/**
 * ★★★ override সত্যিই কার্যকর হয়েছে কি না — **যাচাই করি, ধরে নিই না**।
 *
 *   ⚠️ এটি নীরব-ব্যর্থতার শ্রেণি: Next-এর env অগ্রাধিকার বদলালে
 *   ফাইলটি ঠিকই থাকত, কিন্তু ডেভ আবার আসল Resend/Telegram/Blob-এ
 *   যেত আর কেউ টের পেত না। তাই প্রতিবার সিঙ্কে মেপে দেখা হয়।
 */
{
  // ⚠️ `@next/env` CJS — ESM থেকে namespace ও `.default` দুই রূপেই আসতে পারে
  const mod = await import('@next/env');
  const loadEnvConfig = mod.loadEnvConfig ?? mod.default?.loadEnvConfig;
  if (typeof loadEnvConfig !== 'function') die('@next/env থেকে loadEnvConfig পাওয়া গেল না।');
  loadEnvConfig(process.cwd(), true, { info: () => {}, error: () => {} }, true);
  const leaking = ['RESEND_API_KEY', 'TELEGRAM_BOT_TOKEN', 'BLOB_READ_WRITE_TOKEN'].filter(
    (k) => (process.env[k] ?? '') !== '',
  );
  if (leaking.length) {
    die(
      `override কাজ করেনি — এই কী-গুলো এখনো আসল মান ধরে আছে:\n` +
        `    ${leaking.join(', ')}\n\n` +
        `  ডেভ তাহলে আসল ইমেইল/বট/স্টোরেজে লিখত। Next-এর env\n` +
        `  অগ্রাধিকার বদলে গেছে কি না দেখুন।`,
    );
  }
  console.log('       ✓ Resend · Telegram · Blob — override যাচাই করা হয়েছে');
}

console.log(`
✓ হয়ে গেছে।

  ডেভ DB : localhost:5434 / uidtopup_dev   (০ সারি গ্রাহক-ডেটা)
  স্কিমা   : প্রোডাকশনের হুবহু ডাম্প + মাইগ্রেশন ইতিহাস
  বাইরে   : ইমেইল · টেলিগ্রাম · Blob — সব বন্ধ (আপলোড public/uploads/)

  পরের ধাপ:
    npm run dev:db:seed   # ডেমো ডেটা (⚠️ db:seed নয় — সেটি প্রোডাকশনে যায়)
    npm run dev
`);
