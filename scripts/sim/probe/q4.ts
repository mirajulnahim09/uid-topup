import { db, call, mintCookie } from '../_lib';
(async () => {
  const A = await mintCookie(await db.user.findUniqueOrThrow({ where: { email: 'admin@uidtopup.local' } }));
  for (const p of ['/admin/orders?status=PENDING', '/admin/orders']) {
    const r = await call('q', A, 'GET', p);
    const i = r.text.indexOf('orderNo');
    console.log(p, r.status, 'orderNo idx', i, JSON.stringify(r.text.slice(i - 20, i + 40)), 'matches', (r.text.match(/orderNo/g) || []).length, /দেখানো হচ্ছে/.test(r.text), /কোনো অর্ডার নেই|অর্ডার নেই/.test(r.text));
  }
})().finally(() => db.$disconnect());
