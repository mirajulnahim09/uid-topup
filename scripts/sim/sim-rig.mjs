/**
 * ═══════════════════════════════════════════════════════════
 * ★★★ সিমুলেশন রিগ — ১০,০০০ গ্রাহক / ৳১ কোটি সিন্থেটিক সিমুলেশনের জন্য
 *     **সম্পূর্ণ বিচ্ছিন্ন** প্রোডাকশন বিল্ড
 *
 *     node scripts/sim/sim-rig.mjs build   # sim env দিয়ে next build
 *     node scripts/sim/sim-rig.mjs start   # next start :3100 + TLS :3443
 *
 *   prod-rig.mjs এর সাথে পার্থক্য — কেন আলাদা ফাইল:
 *   ১. ডাটাবেস `uidtopup_sim` (ডেভ DB-র কনটেইনারে আলাদা database) —
 *      ১০k ইউজার ও লাখো অর্ডার ডেভ ডেটায় মেশে না, পরে এক কমান্ডে
 *      `DROP DATABASE` করা যায়।
 *   ২. `__NEXT_PROCESSED_ENV=true` — Next তখন **কোনো** env ফাইল পড়ে না।
 *      prod-rig এ `.env` এর যেসব কী `.env.development` এ নেই, সেগুলো
 *      (লাইভ Resend/Telegram/পেমেন্ট কী) `next start` নিঃশব্দে টেনে নিত।
 *   ৩. প্রতিটি বাইরের ইন্টিগ্রেশন কী **স্পষ্টভাবে খালি** করা হয় — কারণ
 *      Prisma ক্লায়েন্টও নিজে `.env` পড়ে, কিন্তু কেবল *অনির্ধারিত* কী
 *      বসায়; খালি স্ট্রিং "নির্ধারিত", তাই লাইভ মান আর ঢুকতে পারে না,
 *      আর অ্যাপের `Boolean(process.env.X)` তাকে "কনফিগার নেই" দেখে।
 *   ৪. CRON_SECRET প্রতি রানে নতুন র‍্যান্ডম — লাইভটি কখনো নয়।
 *
 *   মান কখনো ছাপা হয় না (CLAUDE.md §2.3) — কেবল কী-এর নাম।
 * ═══════════════════════════════════════════════════════════
 */
import { spawn, spawnSync } from 'node:child_process';
import { readFileSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import path from 'node:path';

const MODE = process.argv[2];
if (!['build', 'start'].includes(MODE)) {
  console.error('ব্যবহার: node scripts/sim/sim-rig.mjs build|start');
  process.exit(1);
}

const SIM_DB = process.env.SIM_DATABASE_URL || 'postgresql://dev:dev@localhost:5434/uidtopup_sim';
const HTTP_PORT = 3100;
const HTTPS_PORT = 3443;

// ── গার্ড: localhost এবং নাম `_sim` দিয়ে শেষ ──
{
  const u = new URL(SIM_DB);
  if (!['localhost', '127.0.0.1', '::1'].includes(u.hostname) || !u.pathname.endsWith('_sim')) {
    console.error(`✗ সিম DB অবশ্যই localhost-এ ও নাম "_sim" দিয়ে শেষ — পাওয়া গেছে ${u.hostname}${u.pathname}`);
    process.exit(1);
  }
}

// ── NEXTAUTH_SECRET — কোনো env ফাইল থেকে নয়। সিম-রিগ নিজেই একটি ফেলনা
//    সিক্রেট বানায় (`.sim/`, gitignored), আর সিম-স্ক্রিপ্ট সেটিই পড়ে সেশন
//    বানায়। ফলে লাইভ বা ডেভ সিক্রেট এই রিগের কোথাও লাগে না। `start` আগের
//    `build`-এর সিক্রেটই রাখে, না থাকলে নতুন বানায়। ──
function simSecret() {
  const f = path.join('.sim', 'nextauth-secret');
  if (existsSync(f)) return readFileSync(f, 'utf8').trim();
  mkdirSync('.sim', { recursive: true });
  const s = randomBytes(32).toString('hex');
  writeFileSync(f, s);
  return s;
}

// কোডে (src/) যত বাইরের-সেবা কী পড়া হয় — সবগুলো খালি
const BLANK = [
  'RESEND_API_KEY', 'TELEGRAM_BOT_TOKEN', 'TELEGRAM_CHAT_ID', 'TELEGRAM_ENC_KEY',
  'GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET', 'BLOB_READ_WRITE_TOKEN',
  'S3_BUCKET', 'S3_ACCESS_KEY_ID', 'S3_SECRET_ACCESS_KEY', 'S3_PUBLIC_URL',
  'UPSTASH_REDIS_REST_URL', 'UPSTASH_REDIS_REST_TOKEN', 'SENTRY_DSN',
  'FF_LOOKUP_API_KEY', 'GAME_API_URL', 'GAME_API_KEY',
  'SSLCZ_BASE_URL', 'SSLCZ_STORE_ID', 'SSLCZ_STORE_PASSWD', 'STRIPE_SECRET_KEY', 'STRIPE_WEBHOOK_SECRET',
  'BKASH_APP_KEY', 'BKASH_APP_SECRET', 'BKASH_PASSWORD', 'BKASH_USERNAME', 'BKASH_SMS_KEY', 'BKASH_SMS_URL',
  'NAGAD_MERCHANT_ID', 'NAGAD_PRIVATE_KEY', 'ROCKET_API_KEY', 'ROCKET_MERCHANT_ID',
  'PAYPAL_CLIENT_ID', 'PAYPAL_SECRET', 'RAZORPAY_KEY_ID', 'RAZORPAY_KEY_SECRET',
  'AWS_SES_ACCESS_KEY', 'AWS_SES_REGION', 'AWS_SES_SECRET_KEY', 'MAILGUN_API_KEY', 'MAILGUN_DOMAIN',
  'SENDGRID_API_KEY', 'SMTP_HOST', 'SMTP_PASS', 'SMTP_USER', 'SMS_GATEWAY_KEY', 'SMS_GATEWAY_URL',
  'TWILIO_ACCOUNT_SID', 'TWILIO_AUTH_TOKEN', 'TWILIO_FROM', 'FCM_SERVER_KEY', 'ONESIGNAL_API_KEY', 'ONESIGNAL_APP_ID',
  'OPENAI_API_KEY', 'ANTHROPIC_API_KEY', 'THIRDPARTY_FULFILL_KEY', 'THIRDPARTY_FULFILL_URL',
  'INTERNAL_AUTOMATION_URL', 'WEBHOOK_IN_SECRET', 'WEBHOOK_OUT_URL',
  'GA_MEASUREMENT_ID', 'PLAUSIBLE_DOMAIN', 'POSTHOG_KEY', 'ADMIN_PASSWORD', 'VERCEL',
];

const cronSecret = randomBytes(24).toString('hex');
const env = { ...process.env };
for (const k of BLANK) env[k] = '';
Object.assign(env, {
  __NEXT_PROCESSED_ENV: 'true',
  NODE_ENV: 'production',
  DATABASE_URL: SIM_DB,
  NEXTAUTH_SECRET: simSecret(),
  NEXTAUTH_URL: `https://localhost:${HTTPS_PORT}`,
  NEXT_PUBLIC_SITE_URL: `https://localhost:${HTTPS_PORT}`,
  CRON_SECRET: cronSecret,
  STORAGE_DRIVER: 'local',
  EMAIL_FROM: 'sim@uidtopup.local',
  STREAM_ENABLED: env.STREAM_ENABLED || '1',
  PROD_HTTP_PORT: String(HTTP_PORT),
  PROD_HTTPS_PORT: String(HTTPS_PORT),
  PORT: String(HTTP_PORT),
});

// ক্রন-যাচাইয়ের জন্য সিক্রেট একটি gitignored ফোল্ডারে (প্রতি রানে নতুন, লাইভ নয়)
mkdirSync('.sim', { recursive: true });
writeFileSync(path.join('.sim', 'cron-secret'), cronSecret);

console.log(`▲ সিম রিগ (${MODE}) · DB ${new URL(SIM_DB).host}${new URL(SIM_DB).pathname} · env ফাইল পড়া বন্ধ · ${BLANK.length}টি বাইরের কী খালি`);

/**
 * ★★★ বিল্ড **আলাদা ফোল্ডারে** (`../v2-simbuild`) — মূল প্রকল্পের `.next` নয়।
 *
 *   ⚠️ মাপা (২০২৬-০৯-২৫): সিমুলেশনের মাঝে কেউ মূল ফোল্ডারে `npm run dev`
 *   চালালেন — `next dev` একই `.next` মুছে নিজের ফাইল লিখল, আর চলমান
 *   `next start` যে রুট তখনো মেমরিতে তোলেনি (`/api/admin/order/refund`)
 *   সেটি ১৩০০ বার `Cannot find module` দিয়ে ৫০০ দিল। ডেভেলপারের দৈনন্দিন
 *   কাজ আর দীর্ঘ সিমুলেশন একই ফোল্ডার ভাগ করতে পারে না।
 *
 *   তাই `build` প্রতিবার সোর্স মিরর করে (robocopy /MIR) — `.env*`, `.git`,
 *   `.next`, `node_modules`, `audit` বাদে; `node_modules` একটি junction।
 *   env ফাইল কপিই হয় না, ফলে ওই ফোল্ডারে Next-এর পড়ার মতো কিছু নেই।
 */
const APP_DIR = path.resolve(process.env.SIM_APP_DIR || path.join('..', 'v2-simbuild'));
function syncAppDir() {
  mkdirSync(APP_DIR, { recursive: true });
  const r = spawnSync('robocopy', [process.cwd(), APP_DIR, '/MIR', '/NFL', '/NDL', '/NJH', '/NJS', '/NP',
    '/XD', 'node_modules', '.next', '.next-test', '.git', 'audit', '.sim', '.certs', 'test-results',
    '/XF', '.env', '.env.*', '*.tsbuildinfo', '*.log'], { stdio: 'inherit' });
  // robocopy: ০–৭ = সফল, ≥৮ = ব্যর্থ
  if (r.status === null || r.status >= 8) { console.error(`✗ robocopy ব্যর্থ (${r.status})`); process.exit(1); }
  const nm = path.join(APP_DIR, 'node_modules');
  if (!existsSync(nm)) {
    const j = spawnSync('cmd', ['/c', 'mklink', '/J', nm, path.resolve('node_modules')], { stdio: 'inherit' });
    if (j.status !== 0) { console.error('✗ node_modules junction বানানো যায়নি'); process.exit(1); }
  }
  for (const f of ['.env', '.env.development', '.env.local', '.env.production']) {
    if (existsSync(path.join(APP_DIR, f))) { console.error(`✗ ${f} সিম-ফোল্ডারে আছে — থামানো হলো`); process.exit(1); }
  }
}

const nextBin = path.join('node_modules', 'next', 'dist', 'bin', 'next');
if (MODE === 'build') {
  syncAppDir();
  console.log(`  সিম-ফোল্ডার: ${APP_DIR}`);
  const b = spawn(process.execPath, [nextBin, 'build', APP_DIR], { stdio: 'inherit', env });
  b.on('exit', (c) => process.exit(c ?? 1));
} else {
  const next = spawn(process.execPath, [nextBin, 'start', APP_DIR, '-p', String(HTTP_PORT), '-H', '127.0.0.1'], { stdio: 'inherit', env });
  const proxy = spawn(process.execPath, [path.join('scripts', 'prod-https.mjs')], { stdio: 'inherit', env });
  const stop = () => { next.kill(); proxy.kill(); };
  process.on('SIGINT', () => { stop(); process.exit(0); });
  process.on('SIGTERM', () => { stop(); process.exit(0); });
  next.on('exit', (c) => { proxy.kill(); process.exit(c ?? 0); });
  proxy.on('exit', (c) => { next.kill(); process.exit(c ?? 0); });
}
