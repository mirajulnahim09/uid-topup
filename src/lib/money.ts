/** Prisma Decimal | number | string — সব হ্যান্ডেল করে */
export type Money = { toString(): string } | number | string;

export function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

/**
 * ★ ল্যাটিন অঙ্ক → বাংলা অঙ্ক (৮২ → ৮২)।
 *
 *   কেন এখানে: `trustMetrics.ts` এর ভিতরে এটির একটি ব্যক্তিগত অনুলিপি
 *   ছিল, আর `sla.ts` এর দরকার হলো — দুটি অনুলিপি মানে একদিন একটিতে
 *   ভুল সারানো হবে, অন্যটিতে নয়।
 *
 * ⚠️ **টাকার অঙ্কে এটি ব্যবহার করা হয় না, ইচ্ছাকৃতভাবে।** `bdt()`
 *   সারা সাইটে `৳1,234.50` লেখে (ল্যাটিন অঙ্ক + হাজার-বিভাজক), আর
 *   গ্রাহক bKash/Nagad-এর অ্যাপেও ঠিক ঐ রূপটিই দেখেন — TrxID মেলানোর
 *   সময় দুটি ভিন্ন রূপ পাশাপাশি রাখলে ভুল হওয়ার ঝুঁকি বাড়ে।
 *   এটি কেবল **গদ্যের ভিতরের** সংখ্যার জন্য (সময়, গণনা, শতাংশ)।
 */
export function toBengaliDigits(v: number | string): string {
  const bn = '০১২৩৪৫৬৭৮৯';
  return String(v).replace(/\d/g, (d) => bn[Number(d)]);
}

/** ৳1,234.50 ফরম্যাটে */
export function bdt(v: Money): string {
  const n = Number(v.toString());
  return `৳${n.toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}
