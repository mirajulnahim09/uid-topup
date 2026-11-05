import { db, call, mintCookie } from '../_lib';
(async () => {
  const u = await db.user.findFirstOrThrow({ where: { email: { startsWith: 'walk-390' } }, orderBy: { createdAt: 'desc' } });
  const r = await call('acc', await mintCookie(u), 'GET', '/account');
  for (const w of ['ORDER', 'DEPOSIT', 'টাকা যোগ', 'অর্ডার']) console.log(w, (r.text.match(new RegExp(`data-label="ধরন"[^>]*>${w}<`, 'g')) || []).length);
})().finally(() => db.$disconnect());
