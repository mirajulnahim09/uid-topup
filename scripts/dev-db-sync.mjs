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
function docker(args, { input, capture, label } = {}) {
  const r = spawnSync('docker', args, {
    input,
    encoding: 'utf8',
    stdio: input !== undefined || capture ? ['pipe', 'pipe', 'pipe'] : 'inherit',
    maxBuffer: 64 * 1024 * 1024,
  });
  if (r.error) die(`docker চালানো গেল না (${label}): ${r.error.message}`);
  if (r.status !== 0) {
    // ⚠️ stderr ছাপি, কিন্তু URL কখনো এতে থাকে না — pg_dump তা ছাপে না
    die(`${label} ব্যর্থ (exit ${r.status}):\n${(r.stderr || '').trim()}`);
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
const schemaSql = pgRun(
  PROD_URL,
  // ⚠️ `--no-owner --no-privileges` — Neon-এর role লোকালে নেই
  // ⚠️ `--schema=public` — Neon-এর অভ্যন্তরীণ স্কিমা বাদ
  'pg_dump "$PGURL" --schema-only --no-owner --no-privileges --no-tablespaces --schema=public',
  { capture: true, label: 'pg_dump (schema)' },
);
if (!/CREATE TABLE/i.test(schemaSql)) die('ডাম্পে কোনো টেবিল নেই — কিছু একটা ভুল।');

// ── ৩. মাইগ্রেশন ইতিহাস (শুধু এই একটি টেবিলের ডেটা) ──
console.log('  ৩/৫  মাইগ্রেশন ইতিহাস ডাম্প (_prisma_migrations) …');
const historySql = pgRun(
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
#   Next.js \`next dev\`-এ এই ফাইলটি \`.env\` এর **উপরে** বসে, তাই
#   এখানে শুধু \`DATABASE_URL\` override করা আছে — বাকি সব মান
#   (NEXTAUTH_SECRET, Blob, Resend, Telegram …) \`.env\` থেকেই আসে।
#
#   ⚠️⚠️ যা এখনো লাইভ: এই ফাইল কেবল **ডাটাবেস** আলাদা করে। ডেভে
#   ইমেইল (Resend), টেলিগ্রাম বট ও Blob আপলোড এখনো আসল সার্ভিসেই
#   যায়। সেগুলোও আলাদা করতে চাইলে সংশ্লিষ্ট কী এখানে override করুন।
#
#   ⚠️ Prisma CLI এই ফাইল **পড়ে না** — সে শুধু \`.env\` দেখে। তাই
#   \`npx prisma studio\` ইত্যাদি এখনো প্রোডাকশনে যাবে। ডেভ DB-তে
#   চালাতে npm script গুলো ব্যবহার করুন (dev:db:*), যেগুলো URL
#   স্পষ্ট করে দেয়।
# ═══════════════════════════════════════════════════════════
DATABASE_URL="${DEV_URL}"
`;
writeFileSync('.env.development', ENV_DEV);

console.log(`
✓ হয়ে গেছে।

  ডেভ DB : localhost:5434 / uidtopup_dev   (০ সারি গ্রাহক-ডেটা)
  স্কিমা   : প্রোডাকশনের হুবহু ডাম্প + মাইগ্রেশন ইতিহাস

  পরের ধাপ:
    npm run dev:db:seed   # ডেমো ডেটা (⚠️ db:seed নয় — সেটি প্রোডাকশনে যায়)
    npm run dev
`);
