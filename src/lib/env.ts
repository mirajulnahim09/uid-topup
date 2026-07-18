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
  { key: 'GOOGLE_CLIENT_ID', hint: 'Google দিয়ে লগইনের জন্য' },
  { key: 'GOOGLE_CLIENT_SECRET', hint: 'Google দিয়ে লগইনের জন্য' },
];

let checked = false;

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
