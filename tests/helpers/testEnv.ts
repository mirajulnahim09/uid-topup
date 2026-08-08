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
