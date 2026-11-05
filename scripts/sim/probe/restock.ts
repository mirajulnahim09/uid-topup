import { db, call, mintCookie } from '../_lib';
(async () => {
  const A = await mintCookie(await db.user.findUniqueOrThrow({ where: { email: 'admin@uidtopup.local' } }));
  const r = await call('restock', A, 'PATCH', '/api/admin/variant', { id: 1, stock: -1 });
  console.log('restock HTTP', r.status, (await db.variant.findUnique({ where: { id: 1 } }))?.stock);
})().finally(() => db.$disconnect());
