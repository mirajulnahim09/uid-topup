/**
 * স্ক্রিপ্টেড লগইনের আগে `RateLimitBucket` খালি করা।
 * ⚠️ `./_db` আগে import করা **বাধ্যতামূলক** — নাহলে Prisma `.env`
 *   (লাইভ Neon) ধরে ফেলে আর এই মোছা প্রোডাকশনে চলে যায়।
 *   `_db` নিজেই স্থানীয় নয় এমন URL হলে থেমে যায়।
 */
import { db, dbLabel } from './_db';

async function main() {
  const r = await db.rateLimitBucket.deleteMany({});
  console.log(`ডাটাবেস: ${dbLabel()} · RateLimitBucket সাফ: ${r.count} সারি`);
}
main().catch((e) => { console.error(e); process.exitCode = 1; }).finally(() => db.$disconnect());
