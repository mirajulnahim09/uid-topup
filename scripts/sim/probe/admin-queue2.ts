import { db, call, mintCookie } from '../_lib';
(async () => {
  const A = await mintCookie(await db.user.findUniqueOrThrow({ where: { email: 'admin@uidtopup.local' } }));
  for (const st of ['PENDING', 'PROCESSING'] as const) {
    const r = await call('q', A, 'GET', `/admin/orders?status=${st}`);
    const shown = new Set([...r.text.matchAll(/orderNo\?":(\d+)/g)].map((m) => Number(m[1])));
    const oldest = (await db.order.findMany({ where: { status: st }, orderBy: { createdAt: 'asc' }, take: 10, select: { orderNo: true } })).map((o) => o.orderNo);
    console.log(st, 'total', await db.order.count({ where: { status: st } }), 'oldest10 shown', oldest.filter((n) => shown.has(n)).length, '/10');
  }
})().finally(() => db.$disconnect());
