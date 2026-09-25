import { db, call, mintCookie } from '../_lib';
(async () => {
  const A = await mintCookie(await db.user.findUniqueOrThrow({ where: { email: 'admin@uidtopup.local' } }));
  const r = await call('q', A, 'GET', `/admin/orders?status=PENDING`);
  const shown = [...r.text.matchAll(/orderNo\?":(\d+)/g)].map((m) => Number(m[1]));
  console.log('HTTP', r.status, r.ms, r.text.length, r.text.slice(0,200).replace(/s+/g,' '));console.log('first shown', shown.slice(0, 8), 'count', shown.length);
  const rows = await db.order.findMany({ where: { orderNo: { in: shown.slice(0, 5) } }, select: { orderNo: true, status: true, createdAt: true } });
  console.log(rows);
  console.log(await db.order.findMany({ where: { status: 'PENDING' }, orderBy: { createdAt: 'asc' }, take: 3, select: { orderNo: true, createdAt: true } }));
})().finally(() => db.$disconnect());
