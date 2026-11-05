/**
 * ═══════════════════════════════════════════════════════════
 * ★ Environment validation — অ্যাপ চালুর সময়েই যাচাই।
 *
 *   কেন দরকার: env ভুল/অনুপস্থিত থাকলে deploy "সফল" হয়ে যায়,
 *   কিন্তু সাইট চুপচাপ ভাঙা থাকে (দুর্বোধ্য runtime error)।
 *   এখানে আগেই ধরা পড়বে, পরিষ্কার বার্তা সহ।
 *
 *   REQUIRED  — না থাকলে অ্যাপ চলবেই না (throw)
 *   OPTIONAL  — না থাকলে সংশ্লিষ্ট ফিচার নীরবে বন্ধ থাকবে (warn)
 * ═══════════════════════════════════════════════════════════
 */

type Check = { key: string; hint: string; validate?: (v: string) => string | null };

const REQUIRED: Check[] = [
  {
    key: 'DATABASE_URL',
    hint: 'Neon/Postgres connection string (postgresql://... ?sslmode=require)',
    validate: (v) => (v.startsWith('postgres://') || v.startsWith('postgresql://') ? null : 'postgresql:// দিয়ে শুরু হতে হবে'),
  },
  {
    key: 'NEXTAUTH_SECRET',
    hint: 'লম্বা random string — `openssl rand -base64 32` দিয়ে বানান',
    validate: (v) => (v.length >= 24 ? null : 'কমপক্ষে ২৪ অক্ষর হতে হবে (নিরাপত্তার জন্য)'),
  },
];

const OPTIONAL: Check[] = [
  { key: 'NEXTAUTH_URL', hint: 'সাইটের URL (production এ বাধ্যতামূলক)' },
  { key: 'BLOB_READ_WRITE_TOKEN', hint: 'Vercel Blob — ছবি আপলোডের জন্য' },
  { key: 'RESEND_API_KEY', hint: 'Resend — ইমেইল ও পাসওয়ার্ড রিসেটের জন্য' },
  /**
   * ★★★ `EMAIL_FROM` — কী থাকার চেয়েও এটি বেশি জরুরি।
   *
   *   সেট না করলে ডিফল্ট `onboarding@resend.dev` (Resend স্যান্ডবক্স),
   *   যা দিয়ে **কেবল অ্যাকাউন্টের নিজের ঠিকানায়** মেইল যায়। ফলে
   *   প্রোডাকশনে RESEND_API_KEY থাকা সত্ত্বেও নতুন কোনো গ্রাহক OTP
   *   পাবেন না, অর্থাৎ **রেজিস্ট্রেশনই অসম্ভব** — অথচ কোথাও কোনো
   *   ত্রুটি দেখা যাবে না। তাই এটি এখানে তালিকাভুক্ত, আর
   *   `health.ts` আলাদা করে স্যান্ডবক্স-প্রেরক ধরে `down` বলে।
   */
  { key: 'EMAIL_FROM', hint: 'যাচাই করা ডোমেইনের প্রেরক ("নাম <no-reply@yourdomain>") — না দিলে Resend স্যান্ডবক্স, তখন গ্রাহক OTP পাবেন না' },
  { key: 'GOOGLE_CLIENT_ID', hint: 'Google দিয়ে লগইনের জন্য' },
  { key: 'GOOGLE_CLIENT_SECRET', hint: 'Google দিয়ে লগইনের জন্য' },
];

let checked = false;

/**
 * NEXTAUTH_URL format. Presence alone was checked before, but NextAuth builds
 * every auth URL from this value: a stray quote, a missing scheme, `http://` on
 * a public host or a page path (e.g. `/login`) breaks sign-in and
 * `/api/auth/session` for every user while the variable still looks "set".
 * Value is never echoed back — only what is wrong with it.
 */
export function nextAuthUrlProblem(raw: string, production: boolean): string | null {
  const v = raw.trim();
  if (/["'\s]/.test(v)) return 'উদ্ধৃতি চিহ্ন বা ফাঁকা জায়গা আছে — কেবল URL দিন (যেমন https://example.com)';
  let u: URL;
  try {
    u = new URL(v);
  } catch {
    return 'বৈধ URL নয় — https:// সহ পুরো ঠিকানা দিন';
  }
  if (u.protocol !== 'https:' && u.protocol !== 'http:') return 'http:// বা https:// দিয়ে শুরু হতে হবে';
  const local = ['localhost', '127.0.0.1', '[::1]'].includes(u.hostname);
  if (production && u.protocol === 'http:' && !local) return 'প্রোডাকশনে https:// হতে হবে — নাহলে লগইন কুকি কাজ করে না';
  if (u.search || u.hash) return '? বা # অংশ থাকা যাবে না';
  const p = u.pathname.replace(/\/+$/, '');
  if (p && p !== '/api/auth') return `পাথ "${p}" থাকা যাবে না — কেবল সাইটের মূল ঠিকানা দিন`;
  return null;
}

/**
 * ★ non-throwing পরিবেশ যাচাই রিপোর্ট (Phase 4 — One Click Validation)
 *   assertEnv() throw করে (boot-guard); এটি একই যুক্তি দিয়ে একটি
 *   রিপোর্ট দেয় — অ্যাডমিন release-checklist এন্ডপয়েন্ট এটি দেখায়।
 *   ⚠️ কোনো মান ফেরত দেয় না — শুধু আছে/নেই ও সমস্যা।
 */
export type EnvReport = {
  ok: boolean;
  required: { key: string; present: boolean; problem: string | null; hint: string }[];
  optional: { key: string; present: boolean; hint: string }[];
};

export function validateEnv(): EnvReport {
  const required = REQUIRED.map((c) => {
    const v = process.env[c.key]?.trim();
    const present = Boolean(v);
    const problem = present ? (c.validate?.(v!) ?? null) : 'সেট করা নেই';
    return { key: c.key, present, problem, hint: c.hint };
  });

  // production-এ NEXTAUTH_URL কার্যত required; যেখানেই সেট, সেখানে ফরম্যাটও যাচাই
  const prod = process.env.NODE_ENV === 'production';
  const authUrl = process.env.NEXTAUTH_URL?.trim();
  if (prod || authUrl) {
    required.push({
      key: 'NEXTAUTH_URL',
      present: Boolean(authUrl),
      problem: authUrl ? nextAuthUrlProblem(authUrl, prod) : 'সেট করা নেই',
      hint: 'সাইটের মূল URL, যেমন https://example.com',
    });
  }

  const optional = OPTIONAL.map((c) => ({
    key: c.key,
    present: Boolean(process.env[c.key]?.trim()),
    hint: c.hint,
  }));

  const ok = required.every((r) => r.present && !r.problem);
  return { ok, required, optional };
}

export function assertEnv(): void {
  // build ধাপে env না থাকলেও build ভাঙা উচিত নয় — শুধু runtime এ যাচাই
  if (checked || process.env.NEXT_PHASE === 'phase-production-build') return;
  checked = true;

  const errors: string[] = [];

  for (const c of REQUIRED) {
    const v = process.env[c.key];
    if (!v || !v.trim()) {
      errors.push(`  ✗ ${c.key} সেট করা নেই — ${c.hint}`);
      continue;
    }
    const problem = c.validate?.(v.trim());
    if (problem) errors.push(`  ✗ ${c.key} ${problem}`);
  }

  // production এ NEXTAUTH_URL ছাড়া OAuth callback ভাঙে
  if (process.env.NODE_ENV === 'production' && !process.env.NEXTAUTH_URL) {
    errors.push('  ✗ NEXTAUTH_URL সেট করা নেই — production এ লগইন কাজ করবে না');
  }

  // Format problems are logged, not thrown: a bad NEXTAUTH_URL breaks sign-in,
  // but throwing here would take the whole storefront down with it.
  const authUrl = process.env.NEXTAUTH_URL?.trim();
  const authUrlProblem = authUrl ? nextAuthUrlProblem(authUrl, process.env.NODE_ENV === 'production') : null;
  if (authUrlProblem) console.error(`✗ NEXTAUTH_URL: ${authUrlProblem}`);

  if (errors.length) {
    throw new Error(
      `\n\n═══ পরিবেশ (.env) সেটআপে সমস্যা ═══\n${errors.join('\n')}\n\n` +
        `.env.example দেখে ঠিক করুন, তারপর আবার চালান।\n`
    );
  }

  if (process.env.NODE_ENV !== 'production') {
    const missing = OPTIONAL.filter((c) => !process.env[c.key]?.trim());
    if (missing.length) {
      console.warn(
        `\n⚠️  ঐচ্ছিক env নেই (সংশ্লিষ্ট ফিচার বন্ধ থাকবে):\n` +
          missing.map((c) => `   · ${c.key} — ${c.hint}`).join('\n') + '\n'
      );
    }
  }
}
