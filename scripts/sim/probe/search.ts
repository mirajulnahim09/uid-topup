import { db, call, mintCookie } from '../_lib';
(async () => {
  const A = await mintCookie(await db.user.findUniqueOrThrow({ where: { email: 'admin@uidtopup.local' } }));
  for (const q of ['4149987572', '414998757', '12345', '1', 'SIM0001']) {
    const r = await call('s', A, 'POST', '/api/admin/search', { q });
    console.log(JSON.stringify(q), r.status, (r.text || '').slice(0, 160));
  }
})().finally(() => db.$disconnect());
