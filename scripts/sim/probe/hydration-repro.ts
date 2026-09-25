// ★ লাইভ-ফিডে "এইমাত্র" আইটেম বানিয়ে Firefox-এ বারবার লোড — হাইড্রেশন-ত্রুটি গোনা
import { db, BASE, call, mintCookie } from '../_lib';
import { firefox } from 'playwright-core';
(async () => {
  const A = await mintCookie(await db.user.findUniqueOrThrow({ where: { email: 'admin@uidtopup.local' } }));
  const users = await db.user.findMany({ where: { email: { startsWith: 'sim-' }, balance: { gt: 200 } }, take: 6 });
  const v = await db.variant.findFirstOrThrow({ where: { isActive: true, stock: -1 }, orderBy: { price: 'asc' } });
  await db.rateLimitBucket.deleteMany({});
  const b = await firefox.launch({ headless: true });
  let total = 0;
  for (let round = 0; round < 6; round++) {
    // প্রতি রাউন্ডে একটি নতুন সম্পন্ন অর্ডার — ফিডে সবসময় সদ্য-সময়ের আইটেম
    const u = users[round % users.length];
    const o = await call('o', await mintCookie(u), 'POST', '/api/order', { variantId: v.id, playerUid: '1234567890', clientRef: `hyd-${Date.now()}` });
    if (o.json?.orderId) await call('c', A, 'POST', '/api/admin/order', { orderId: o.json.orderId, action: 'COMPLETE', takeover: true });
    await new Promise((r) => setTimeout(r, 55_000 + round * 1000)); // মিনিট-সীমার কাছে
    const ctx = await b.newContext({ ignoreHTTPSErrors: true, viewport: { width: 390, height: 844 }, locale: 'bn-BD', colorScheme: 'dark', hasTouch: true });
    await ctx.addInitScript(() => { try { localStorage.setItem('theme', 'dark'); } catch { /* */ } });
    const p = await ctx.newPage(); let n = 0; p.on('pageerror', (e) => { if (/#4(18|23|25)/.test(String(e))) n++; });
    await p.goto(`${BASE}/`, { waitUntil: 'networkidle' }); await p.waitForTimeout(3000);
    console.log(`round ${round}: hydration errors ${n}`); total += n;
    await ctx.close();
  }
  console.log('মোট', total);
  await b.close();
})().finally(() => db.$disconnect());
