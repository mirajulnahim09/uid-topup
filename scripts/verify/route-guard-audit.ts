/**
 * ═══════════════════════════════════════════════════════════
 * ★★★ C5 — প্রতিটি API রুটের গার্ড তালিকা
 *
 *   `npx tsx scripts/verify/route-guard-audit.ts`
 *
 *   প্রতিটি `src/app/api/**\/route.ts` পড়ে বের করে কোন গার্ড আছে:
 *     requireAdmin · requireUser · assertCronAuth · verifyCronSecret
 *     · webhook স্বাক্ষর · ইচ্ছাকৃত পাবলিক
 *
 *   যেগুলো কোনো গার্ড ছাড়া অথচ পাবলিক-তালিকাতেও নেই — সেগুলোই
 *   প্রকৃত ফাঁক, এবং exit code ১ দেয়।
 * ═══════════════════════════════════════════════════════════
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';

const API_ROOT = path.join(process.cwd(), 'src', 'app', 'api');

/**
 * ★ ইচ্ছাকৃতভাবে অননুমোদিত রুট — প্রতিটির কারণ লেখা।
 *   এখানে কিছু যোগ করা মানে "এটি পাবলিক থাকা উচিত" — হালকাভাবে নয়।
 */
const INTENTIONALLY_PUBLIC: Record<string, string> = {
  'auth/[...nextauth]': 'NextAuth নিজেই — লগইন/সেশন handshake',
  'auth/2fa-check': 'লগইনের আগে চলে; লগইনের একই login:ip/login:email বাজেট + fail-closed (C4, AUTH-03)',
  'auth/login-status': 'লগইন ব্যর্থতার কারণ; কেবল বাকেট পড়ে, কিছু ফাঁস করে না',
  'auth/forgot': 'লগ-আউট অবস্থায় দরকার; IP rate-limit + enumeration-প্রতিরোধী',
  'auth/reset': 'রিসেট-টোকেনই প্রমাণ; IP rate-limit',
  'register': 'নতুন অ্যাকাউন্ট — সংজ্ঞা অনুযায়ী অননুমোদিত; IP rate-limit',
  'track': 'অর্ডার নং + ফোন দিয়ে ট্র্যাক; কড়া IP rate-limit',
  'health': 'আপটাইম প্রোব — কোনো সংবেদনশীল তথ্য নেই',
  'search': 'পাবলিক ক্যাটালগ সার্চ — যা ফেরে তা হোমপেজেই খোলা; IP rate-limit',
  // ★ Group I (৩) — ইউজার এখনো তৈরিই হয়নি, তাই গার্ড দেওয়া অসম্ভব।
  //   সুরক্ষা: fail-closed IP rate-limit + গন্তব্য-ভিত্তিক চেষ্টা-গণনা,
  //   আর উত্তর নিবন্ধিত/অনিবন্ধিত দুই ক্ষেত্রেই হুবহু এক (enumeration বন্ধ)।
  'auth/otp/send': 'রেজিস্ট্রেশনের কোড — ইউজার তৈরির আগে; fail-closed rate-limit',
  'uid/recent': 'সাম্প্রতিক যাচাই-করা UID (সর্বজনীন শোকেস)',
  'webhooks/payment/[provider]': 'গেটওয়ে কল করে; স্বাক্ষর যাচাই দিয়ে সুরক্ষিত',
  'cron/telegram-scheduler': 'assertCronAuth (Bearer CRON_SECRET)',
  'cron/sla-breach': 'assertCronAuth (Bearer CRON_SECRET)',
  'cron/ratelimit-cleanup': 'assertCronAuth (Bearer CRON_SECRET)',
};

type Row = { route: string; guards: string[]; ok: boolean; note: string };

function walk(dir: string, acc: string[] = []): string[] {
  for (const e of readdirSync(dir)) {
    const p = path.join(dir, e);
    if (statSync(p).isDirectory()) walk(p, acc);
    else if (e === 'route.ts' || e === 'route.tsx') acc.push(p);
  }
  return acc;
}

const files = walk(API_ROOT).sort();
const rows: Row[] = [];

for (const file of files) {
  const src = readFileSync(file, 'utf8');
  const route = path
    .relative(API_ROOT, path.dirname(file))
    .split(path.sep)
    .join('/');

  const guards: string[] = [];
  if (/\brequireAdmin\s*\(/.test(src)) guards.push('requireAdmin');
  if (/\brequireUser\s*\(/.test(src)) guards.push('requireUser');
  // ★ Group F — রিসেলারের API কী। এটি সেশন-ভিত্তিক গার্ড নয়, কিন্তু
  //   গার্ডই: হ্যাশ-যাচাই + ban + tier পরীক্ষা করে (`src/lib/apiKey.ts`)।
  //   "ইচ্ছাকৃত পাবলিক" তালিকায় রাখলে ভুল হতো — রুটটি পাবলিক নয়।
  if (/\brequireApiKey\s*\(/.test(src)) guards.push('requireApiKey');
  if (/\bassertCronAuth\s*\(/.test(src)) guards.push('assertCronAuth');
  if (/\bverifyCronSecret\s*\(/.test(src)) guards.push('verifyCronSecret');
  if (/verifyWebhookSignature|webhookSignature/.test(src)) guards.push('webhookSignature');
  if (/getServerSession\s*\(/.test(src)) guards.push('getServerSession');

  const isPublic = route in INTENTIONALLY_PUBLIC;
  const ok = guards.length > 0 || isPublic;
  rows.push({
    route: '/' + route,
    guards,
    ok,
    note: isPublic ? INTENTIONALLY_PUBLIC[route] : '',
  });
}

console.log('═══ C5 — API রুট গার্ড অডিট ═══\n');
console.log(`  মোট রুট ফাইল: ${rows.length}\n`);

const guarded = rows.filter((r) => r.guards.length > 0);
const publicOk = rows.filter((r) => r.guards.length === 0 && r.ok);
const gaps = rows.filter((r) => !r.ok);

console.log(`── গার্ড আছে (${guarded.length}) ──`);
for (const r of guarded) console.log(`  ${r.route.padEnd(42)} ${r.guards.join(' + ')}`);

console.log(`\n── ইচ্ছাকৃত পাবলিক (${publicOk.length}) ──`);
for (const r of publicOk) console.log(`  ${r.route.padEnd(42)} ${r.note}`);

console.log(`\n── ⚠️ গার্ডহীন ও তালিকাভুক্ত নয় (${gaps.length}) ──`);
if (!gaps.length) console.log('  (কোনোটি নেই)');
for (const r of gaps) console.log(`  ${r.route}`);

console.log('\n════════════════════════════════════════');
console.log(gaps.length ? `  ${gaps.length} টি ফাঁক` : '  কোনো অরক্ষিত রুট নেই');
process.exit(gaps.length ? 1 : 0);
