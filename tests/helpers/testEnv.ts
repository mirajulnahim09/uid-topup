/**
 * ═══════════════════════════════════════════════════════════
 * ★★★ টেস্ট ডাটাবেসের একমাত্র উৎস ও তার গার্ড (Group D)
 *
 *   গার্ডটি আগে `vitest.setup.ts` ও `scripts/test-run.mjs` — দুই
 *   জায়গায় হাতে লেখা ছিল। এখন HTTP হারনেস যোগ হওয়ায় তৃতীয় একটি
 *   কল-সাইট (globalSetup) লাগত। একটি **নিরাপত্তা** গার্ডের তিনটি
 *   কপি রাখা মানে একদিন একটিতে শর্ত শিথিল হবে আর কেউ টের পাবে না।
 *   তাই একটিই উৎস।
 *
 *   ⚠️ কোনো পরিস্থিতিতে এই শর্তগুলো শিথিল করবেন না — টেস্ট প্রতিটি
 *   টেবিল truncate করে (CLAUDE.md §2.1)।
 * ═══════════════════════════════════════════════════════════
 */

export const TEST_DATABASE_URL =
  process.env.TEST_DATABASE_URL ||
  'postgresql://test:test@localhost:5433/uidtopup_test';

/**
 * ★ BKP-01 — টেস্ট-সার্ভারের ব্যাকআপ-স্বাক্ষর চাবি (কেবল টেস্ট; প্রোডাকশনের
 *   কোনো গোপন মান নয়)। globalSetup এটি সার্ভারে `BACKUP_SIGNING_KEY` হিসেবে
 *   দেয়, আর টেস্ট-প্রসেস একই মান বসিয়ে `verifyBackup()` চালায়।
 */
export const TEST_BACKUP_SIGNING_KEY = 'uidtopup-test-only-backup-signing-key';

/** ★ SEC-05 — cron-Bearer পথ HTTP-তে পরীক্ষার জন্য টেস্ট-কেবল মান (লাইভ নয়) */
export const TEST_CRON_SECRET = 'test-only-cron-secret-not-a-real-key-0000';

/** ★ টেস্টে ব্যবহৃত স্থির secret — প্রোডাকশনের `NEXTAUTH_SECRET` নয়। */
export const TEST_NEXTAUTH_SECRET = 'test-only-nextauth-secret-not-a-real-key-000000';

/**
 * ═══════════════════════════════════════════════════════════
 * ★★★ টেস্টের গোপন-মান বিচ্ছিন্নতা — একটিই উৎস
 *
 *   মাপা (২০২৬-০৯-২৬): `@prisma/client` import হওয়ামাত্র Prisma নিজেই
 *   প্রকল্পের `.env` পড়ে `process.env`-এ **যে কী আগে থেকে নেই** সেগুলো বসায়
 *   (১৬টি লাইভ কী — NEXTAUTH_SECRET, TELEGRAM_BOT_TOKEN, RESEND_API_KEY …)।
 *   ফলে টেস্ট-প্রসেসে CFG-01-এর ইউনিট টেস্ট **লাইভ বট দিয়ে** টেলিগ্রামে POST
 *   করার চেষ্টা করত (fetch আটকে প্রমাণিত), আর globalSetup `...rest` দিয়ে কয়েকটি
 *   লাইভ কী (CRON_SECRET, TELEGRAM_ENC_KEY, ADMIN_PASSWORD …) টেস্ট-সার্ভারেও দিত।
 *
 *   সমাধান: প্রতিটি গোপন/ইন্টিগ্রেশন কী **আগেই** স্পষ্ট টেস্ট-মানে (বেশিরভাগ
 *   খালি) বসানো — Prisma ও `@next/env` দুজনেই বিদ্যমান কী ওভাররাইট করে না।
 *   একই তালিকা টেস্ট-প্রসেসে (vitest.config `env`) ও টেস্ট-সার্ভারে (globalSetup)।
 *   যে টেস্টের কোনো কী লাগে, সে নিজে `vi.stubEnv`/নিজস্ব mock দিয়ে বসায়।
 * ═══════════════════════════════════════════════════════════
 */
const BLANK_IN_TESTS = [
  // অ্যাপ নিজে পড়ে
  'TELEGRAM_BOT_TOKEN', 'TELEGRAM_CHAT_ID', 'TELEGRAM_ENC_KEY', 'RESEND_API_KEY',
  'GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET', 'BLOB_READ_WRITE_TOKEN', 'BLOB_PUBLIC_HOST',
  'ADMIN_EMAIL', 'ADMIN_PASSWORD', 'FF_LOOKUP_API_KEY',
  'UPSTASH_REDIS_REST_URL', 'UPSTASH_REDIS_REST_TOKEN', 'SENTRY_DSN',
  'S3_BUCKET', 'S3_ACCESS_KEY_ID', 'S3_SECRET_ACCESS_KEY', 'S3_PUBLIC_URL',
  'SSLCZ_STORE_ID', 'SSLCZ_STORE_PASSWD', 'STRIPE_SECRET_KEY', 'STRIPE_WEBHOOK_SECRET',
  'GAME_API_URL', 'GAME_API_KEY',
  // পেমেন্ট/ইন্টিগ্রেশন রেজিস্ট্রির কী (`process.env[k]` দিয়ে পড়া হয়)
  'BKASH_APP_KEY', 'BKASH_APP_SECRET', 'BKASH_PASSWORD', 'BKASH_USERNAME', 'BKASH_SMS_KEY', 'BKASH_SMS_URL',
  'NAGAD_MERCHANT_ID', 'NAGAD_PRIVATE_KEY', 'ROCKET_API_KEY', 'ROCKET_MERCHANT_ID',
  'PAYPAL_CLIENT_ID', 'PAYPAL_SECRET', 'RAZORPAY_KEY_ID', 'RAZORPAY_KEY_SECRET',
  'AWS_SES_ACCESS_KEY', 'AWS_SES_REGION', 'AWS_SES_SECRET_KEY', 'MAILGUN_API_KEY', 'MAILGUN_DOMAIN',
  'SENDGRID_API_KEY', 'SMTP_HOST', 'SMTP_PASS', 'SMTP_USER', 'SMS_GATEWAY_KEY', 'SMS_GATEWAY_URL',
  'TWILIO_ACCOUNT_SID', 'TWILIO_AUTH_TOKEN', 'TWILIO_FROM', 'FCM_SERVER_KEY', 'ONESIGNAL_API_KEY', 'ONESIGNAL_APP_ID',
  'OPENAI_API_KEY', 'ANTHROPIC_API_KEY', 'THIRDPARTY_FULFILL_KEY', 'THIRDPARTY_FULFILL_URL',
  'INTERNAL_AUTOMATION_URL', 'WEBHOOK_IN_SECRET', 'WEBHOOK_OUT_URL',
] as const;

export const TEST_ISOLATED_ENV: Readonly<Record<string, string>> = Object.freeze({
  ...Object.fromEntries(BLANK_IN_TESTS.map((k) => [k, ''])),
  // ★ DATABASE_URL-ও — `npx vitest` সরাসরি চালালে main প্রসেসে এটি থাকে না,
  //   তখন Prisma `.env`-এর **লাইভ** URL বসাত
  DATABASE_URL: TEST_DATABASE_URL,
  // Prisma's `directUrl`. Without it, a direct `npx vitest run <file>` stopped in
  // globalSetup because `.env`'s DIRECT_URL leaked into the test process (a key
  // that may hold the live database). Same value as DATABASE_URL: no pooler here.
  DIRECT_URL: TEST_DATABASE_URL,
  NEXTAUTH_SECRET: TEST_NEXTAUTH_SECRET,
  BACKUP_SIGNING_KEY: TEST_BACKUP_SIGNING_KEY,
  CRON_SECRET: TEST_CRON_SECRET,
});

/**
 * ★ `.env` থেকে টেস্ট-প্রসেসে ঢুকতে পারে এমন **অ-গোপন** কনফিগ — কেবল এগুলো।
 *   এর বাইরে কিছু ঢুকলে (যেমন ভবিষ্যতে `.env`-এ নতুন কোনো কী) `vitest.setup.ts`
 *   টেস্ট **থামিয়ে দেয়** — নতুন গোপন মান নীরবে টেস্টে পৌঁছাবে না (fail-closed)।
 */
export const NON_SECRET_ENV_ALLOWED: ReadonlySet<string> = new Set([
  'NEXTAUTH_URL', 'STORAGE_DRIVER', 'EMAIL_FROM', 'NEXT_PUBLIC_SITE_URL', 'NODE_ENV', 'TZ',
]);

/**
 * ★ `@prisma/client` import-এর **আগে** ডাকুন: গোপন কী টেস্ট-মানে বসায় আর
 *   বর্তমান কী-তালিকার ছবি ফেরত দেয় (`assertNoLiveEnv`-এর জন্য)।
 */
export function applyIsolatedEnv(): Set<string> {
  Object.assign(process.env, TEST_ISOLATED_ENV);
  return new Set(Object.keys(process.env));
}

/**
 * ★ `@prisma/client` import-এর **পরে** ডাকুন — fail-closed:
 *   ১. প্রতিটি গোপন/ইন্টিগ্রেশন কী ঠিক টেস্ট-মানে (`overridden` = ইচ্ছাকৃত mock মান);
 *   ২. ছবির পরে নতুন যা ঢুকেছে (অর্থাৎ `.env` থেকে) তা কেবল অনুমোদিত অ-গোপন কনফিগ।
 *   ⚠️ ত্রুটিবার্তায় কেবল কী-এর **নাম**, কখনো মান নয়।
 */
export function assertNoLiveEnv(
  before: ReadonlySet<string>,
  env: NodeJS.ProcessEnv = process.env,
  overridden: readonly string[] = [],
): void {
  const wrong = Object.entries(TEST_ISOLATED_ENV)
    .filter(([k, v]) => !overridden.includes(k) && env[k] !== v)
    .map(([k]) => k);
  const leaked = Object.keys(env).filter((k) => !before.has(k) && !NON_SECRET_ENV_ALLOWED.has(k));
  if (wrong.length || leaked.length) {
    throw new Error(
      `\n✗ থামানো হলো — টেস্টে লাইভ/অজানা env কী পৌঁছেছে (কোনো টেস্ট চালানো হয়নি)।\n` +
        (wrong.length ? `  টেস্ট-মানে নেই: ${wrong.join(', ')}\n` : '') +
        (leaked.length ? `  .env থেকে অননুমোদিত কী: ${leaked.join(', ')}\n` : '') +
        `  tests/helpers/testEnv.ts-এর TEST_ISOLATED_ENV-এ কীটি যোগ করুন।\n`,
    );
  }
}

/** ★ localhost-এ চলা ডকার কনটেইনারের অনুমোদিত হোস্টনাম */
const LOCAL_HOSTS = ['localhost', '127.0.0.1', '::1', 'test-db'];

export function assertSafeTestUrl(url: string = TEST_DATABASE_URL): void {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    throw new Error(`TEST_DATABASE_URL পার্স হয়নি: ${url}`);
  }

  const host = u.hostname;
  const name = u.pathname.replace(/^\//, '');

  if (!LOCAL_HOSTS.includes(host)) {
    throw new Error(
      `\n✗ থামানো হলো — টেস্ট ডাটাবেসের হোস্ট "${host}", localhost নয়।\n` +
        `  টেস্ট প্রতিটি টেবিল truncate করে। রিমোট (Neon) ডাটাবেসে\n` +
        `  চালানো সম্পূর্ণ নিষিদ্ধ — CLAUDE.md §2.1।\n` +
        `  ডকার চালু করুন: npm run test:db:up\n`,
    );
  }
  if (!name.endsWith('_test')) {
    throw new Error(
      `\n✗ থামানো হলো — ডাটাবেসের নাম "${name}" "_test" দিয়ে শেষ হয় না।\n`,
    );
  }

  /**
   * ⚠️ এখানে আগে তৃতীয় একটি গার্ড ছিল: "টেস্ট URL যেন
   * `process.env.DATABASE_URL` এর সমান না হয়"। সেটি **সরানো হয়েছে**,
   * কারণ শর্তটি অসংগত ছিল — `scripts/test-run.mjs` ও `globalSetup.ts`
   * ইচ্ছাকৃতভাবে `DATABASE_URL` কে টেস্ট URL বানিয়ে সাব-প্রসেসে পাঠায়
   * (যাতে prisma/Next ভুল করেও প্রোডাকশনে না যায়)। ফলে শর্তটি আমাদের
   * নিজেদের হারনেসে **সবসময়** সত্য হতো।
   *
   * পুরনো `vitest.setup.ts`-এ এটি কখনো ধরা পড়েনি কেবল এই কারণে যে
   * তার `catch` ব্লকটি নিজের throw করা Error-টিই গিলে ফেলত — অর্থাৎ
   * গার্ডটি লেখা ছিল কিন্তু কার্যত নিষ্ক্রিয়।
   *
   * আসল সুরক্ষা উপরের দুটিতেই সম্পূর্ণ: প্রোডাকশন Neon একটি **রিমোট**
   * হোস্ট (গার্ড ১ আটকায়) এবং তার নাম `_test` দিয়ে শেষ হয় না
   * (গার্ড ২ আটকায়)। এর সাথে `globalSetup.ts`-এর canary-প্রমাণ
   * নিশ্চিত করে যে চলমান সার্ভারটিও টেস্ট DB-তেই আছে।
   */
}
