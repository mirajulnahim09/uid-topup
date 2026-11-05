/**
 * ═══════════════════════════════════════════════════════════
 * ★★★ দিনের সীমা কোন টাইমজোনে — ঢাকা নাকি সার্ভারের?
 *     (চূড়ান্ত মাস্টার অডিট, ২০২৬-০৯-১৭)
 *
 *   ব্যবসা চলে ঢাকার দিনে (UTC+6), কিন্তু Vercel সার্ভার UTC-তে চলে।
 *   `setHours(0,0,0,0)` / `new Date('YYYY-MM-DD')` সার্ভারের সময় ধরে।
 *
 *   পরীক্ষা: ৩ দিন আগের ঢাকা-তারিখ D-তে দুটি চিহ্নিত অর্ডার (FAILED, টাকা নেই):
 *     · M1 = D-এর ঢাকা রাত ০২:০০  → D-এর রিপোর্টে **থাকা উচিত**
 *     · M2 = D+1-এর ঢাকা ভোর ০৩:০০ → D-এর রিপোর্টে **থাকা উচিত নয়**
 *   `/api/admin/reports?type=orders&from=D&to=D` CSV-তে খোঁজা হয়।
 *
 *   রিগ দুইভাবে চালিয়ে তুলনা: মেশিনের TZ (ঢাকা) ও `TZ=UTC` (Vercel-এর মতো)।
 *   চালানো: VERIFY_BASE=https://localhost:3443 npx tsx scripts/verify/timezone-boundary.ts
 * ═══════════════════════════════════════════════════════════
 */
import { db, BASE, dbLabel } from './_db';
import { request } from 'playwright-core';

const DHAKA_MS = 6 * 3600_000;

async function main() {
  const ctx = await request.newContext({ ignoreHTTPSErrors: true });
  await db.rateLimitBucket.deleteMany({});
  const { csrfToken } = await (await ctx.get(`${BASE}/api/auth/csrf`)).json();
  await ctx.post(`${BASE}/api/auth/callback/credentials`, {
    form: { csrfToken, email: 'admin@uidtopup.local', password: 'Admin@2026Secure', json: 'true' }, maxRedirects: 0, failOnStatusCode: false,
  });

  // ঢাকা-তারিখ D (৩ দিন আগে) — "YYYY-MM-DD"
  const D = new Date(Date.now() + DHAKA_MS - 3 * 864e5).toISOString().slice(0, 10);
  const dhaka = (ymd: string, hh: number) => new Date(Date.parse(`${ymd}T00:00:00Z`) - DHAKA_MS + hh * 3600_000);
  const next = new Date(Date.parse(`${D}T00:00:00Z`) + 864e5).toISOString().slice(0, 10);

  const user = await db.user.findFirstOrThrow({ where: { email: 'customer@uidtopup.local' } });
  const variant = await db.variant.findFirstOrThrow({ where: { isActive: true } });
  const base = { userId: user.id, variantId: variant.id, subtotal: 1, price: 1, productName: 'TZ', variantName: 'TZ', status: 'FAILED' as const };
  await db.order.deleteMany({ where: { playerUid: { in: ['TZMARK1', 'TZMARK2'] } } });
  await db.order.create({ data: { ...base, playerUid: 'TZMARK1', createdAt: dhaka(D, 2) } });
  await db.order.create({ data: { ...base, playerUid: 'TZMARK2', createdAt: dhaka(next, 3) } });

  try {
    const res = await ctx.get(`${BASE}/api/admin/reports?type=orders&from=${D}&to=${D}`);
    const csv = await res.text();
    const m1 = csv.includes('TZMARK1');
    const m2 = csv.includes('TZMARK2');
    console.log(`ডাটাবেস: ${dbLabel()} · সার্ভার: ${BASE} · এই স্ক্রিপ্টের TZ: ${Intl.DateTimeFormat().resolvedOptions().timeZone}`);
    console.log(`PAGE: /api/admin/reports?from=${D}&to=${D} | ROLE: অ্যাডমিন | ACTION: ঢাকা-দিন ${D} এর অর্ডার CSV`);
    console.log(`  M1 (${D} ঢাকা ০২:০০) — EXPECTED: আছে | ACTUAL: ${m1 ? 'আছে' : 'নেই'} | RESULT: ${m1 ? 'PASS' : 'FAIL'}`);
    console.log(`  M2 (${next} ঢাকা ০৩:০০) — EXPECTED: নেই | ACTUAL: ${m2 ? 'আছে' : 'নেই'} | RESULT: ${!m2 ? 'PASS' : 'FAIL'}`);
    if (!m1 || m2) process.exitCode = 1;
  } finally {
    await db.order.deleteMany({ where: { playerUid: { in: ['TZMARK1', 'TZMARK2'] } } });
    await db.rateLimitBucket.deleteMany({});
    await ctx.dispose();
  }
}

main().catch((e) => { console.error(e); process.exitCode = 1; }).finally(() => db.$disconnect());
