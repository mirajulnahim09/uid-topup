/**
 * ═══════════════════════════════════════════════════════════
 * ★★★ টেস্ট ডাটাবেসের URL — এবং প্রোডাকশন ছোঁয়ার বিরুদ্ধে গার্ড
 *
 *   Group D-র জন্য একটি **আলাদা** ডাটাবেস দরকার। এই মেশিনে Docker
 *   নেই, তাই একই Neon ইনস্ট্যান্সে আলাদা ডাটাবেস (`<name>_test`)
 *   ব্যবহার করা হয় — `neondb_owner` রোলের `CREATE DATABASE` অনুমতি আছে।
 *
 *   ⚠️⚠️ সবচেয়ে বড় ঝুঁকি: টেস্ট ভুল করে **প্রোডাকশন** ডাটাবেসে
 *   চলা। টেস্ট প্রতিটি টেবিল truncate করে — একবার ভুল হলে আসল
 *   গ্রাহক ও খতিয়ান মুছে যেত। তাই এখানে একটি **কঠিন গার্ড**:
 *   ডাটাবেসের নাম `_test` দিয়ে শেষ না হলে প্রক্রিয়া থেমে যায়।
 *   কোনো পরিস্থিতিতেই এই গার্ড শিথিল করবেন না।
 *
 *   ⚠️ URL কোথাও **সংরক্ষণ করা হয় না** — `DATABASE_URL` থেকে
 *   রানটাইমে বানানো হয়, যাতে আরেকটি জায়গায় সিক্রেট না জমে।
 * ═══════════════════════════════════════════════════════════
 */

/** প্রোডাকশন URL থেকে টেস্ট URL — কেবল ডাটাবেসের নাম বদলায় */
export function deriveTestUrl(prodUrl) {
  if (!prodUrl) throw new Error('DATABASE_URL সেট নেই');
  const u = new URL(prodUrl);
  const name = u.pathname.replace(/^\//, '');
  if (!name) throw new Error('DATABASE_URL এ ডাটাবেসের নাম পাওয়া যায়নি');
  u.pathname = `/${name}_test`;
  return u.toString();
}

/** নাম বের করা */
export function dbNameOf(url) {
  return new URL(url).pathname.replace(/^\//, '');
}

/**
 * ★★★ গার্ড — টেস্ট চালানোর আগে **সবসময়** ডাকতে হবে।
 *   না মিললে throw; কলার প্রক্রিয়া থামাবে।
 */
export function assertTestDatabase(url) {
  const name = dbNameOf(url);
  if (!name.endsWith('_test')) {
    throw new Error(
      `\n✗ থামানো হলো — টেস্ট ডাটাবেসের নাম "${name}", যা "_test" দিয়ে শেষ হয় না।\n` +
      `  টেস্ট প্রতিটি টেবিল truncate করে; ভুল ডাটাবেসে চললে আসল\n` +
      `  গ্রাহক ও খতিয়ান মুছে যেত। গার্ড শিথিল করবেন না।\n`,
    );
  }
  const prod = process.env.DATABASE_URL;
  if (prod && dbNameOf(prod) === name) {
    throw new Error('\n✗ থামানো হলো — টেস্ট ও প্রোডাকশন ডাটাবেস একই।\n');
  }
  return url;
}

/** সুবিধার জন্য: env থেকে নাও, নাহলে derive করো — সবসময় গার্ডসহ */
export function resolveTestUrl() {
  const url = process.env.TEST_DATABASE_URL || deriveTestUrl(process.env.DATABASE_URL);
  return assertTestDatabase(url);
}
