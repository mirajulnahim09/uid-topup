import { db, call, mintCookie } from '../_lib';
(async () => {
  await db.rateLimitBucket.deleteMany({});
  const u = await db.user.findFirstOrThrow({ where: { email: { endsWith: '@sim.invalid' }, balance: { gt: 1000 } } });
  const v = await db.variant.findFirstOrThrow({ where: { isActive: true, price: { gte: 250, lte: 800 } } });
  const c = await mintCookie(u);
  for (const code of ['SIMSAVE10', 'SIMFLAT20', 'WELCOME10']) {
    const chk = await call('p', c, 'POST', '/api/coupon/check', { code, variantId: v.id });
    const r = await call('p', c, 'POST', '/api/order', { variantId: v.id, playerUid: '1234567890', couponCode: code, expectedPrice: Number(v.price), clientRef: 'probe-' + code + Date.now() });
    console.log(code, 'check', chk.status, JSON.stringify(chk.json).slice(0, 160), '| order', r.status, JSON.stringify(r.json).slice(0, 200));
  }
})().finally(() => db.$disconnect());
