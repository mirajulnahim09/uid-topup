import { db, call, mintCookie } from '../_lib';
(async () => {
  const A = await mintCookie(await db.user.findUniqueOrThrow({ where: { email: 'admin@uidtopup.local' } }));
  const before = await db.variant.findUniqueOrThrow({ where: { id: 3 } });
  const cases: Array<[string, object, number]> = [
    ['stock 1.5', { stock: 1.5 }, 400], ['stock -5', { stock: -5 }, 400], ['stock 1e9', { stock: 1e9 }, 400],
    ['price 0', { price: 0 }, 400], ['price 1e13', { price: 1e13 }, 400], ['price 10.555', { price: 10.555 }, 400],
    ['stock -1 (সীমাহীন)', { stock: -1 }, 200], ['stock 25', { stock: 25 }, 200], ['price সঠিক', { price: Number(before.price) }, 200],
  ];
  let fail = 0;
  for (const [n, body, want] of cases) {
    const r = await call('v', A, 'PATCH', '/api/admin/variant', { id: 3, ...body });
    const ok = r.status === want; if (!ok) fail++;
    console.log(`${ok ? '✓' : '✗'} ${n} → ${r.status} ${r.json?.error ?? ''}`);
  }
  await call('v', A, 'PATCH', '/api/admin/variant', { id: 3, stock: before.stock, price: Number(before.price) });
  const after = await db.variant.findUniqueOrThrow({ where: { id: 3 } });
  console.log('পুনরুদ্ধার', after.stock === before.stock && Number(after.price) === Number(before.price), '· ব্যর্থ', fail);
})().finally(() => db.$disconnect());
