// ★ অ্যাডমিন অর্ডার-কিউ: পর্দায় কোন অর্ডারগুলো আসে বনাম সবচেয়ে পুরনো অপেক্ষমাণ
import { db, call, mintCookie, saveJson } from '../_lib';
(async () => {
  const A = await mintCookie(await db.user.findUniqueOrThrow({ where: { email: 'admin@uidtopup.local' } }));
  const out: any = {};
  for (const path of ['/admin/orders?status=PENDING', '/admin/orders']) {
    const r = await call('q', A, 'GET', path);
    const shown = [...new Set([...r.text.matchAll(/orderNo\\?":(\d+)/g)].map((m) => Number(m[1])))];
    const pend = await db.order.findMany({ where: { status: { in: ['PENDING', 'PROCESSING'] } }, orderBy: { createdAt: 'asc' }, select: { orderNo: true, slaDueAt: true } });
    const oldest10 = pend.slice(0, 10).map((o) => o.orderNo);
    const breachedDb = pend.filter((o) => o.slaDueAt && o.slaDueAt < new Date()).length;
    const oldestShown = oldest10.filter((n) => shown.includes(n)).length;
    const banner = (r.text.match(/(\d[\d,]*) টি অর্ডারের সময় পেরিয়ে গেছে/) || [])[1] ?? 'নেই';
    const note = /দেখানো হচ্ছে/.test(r.text);
    out[path] = { status: r.status, openInDb: pend.length, breachedInDb: breachedDb, shownCount: shown.length, oldest10InDb: oldest10, oldest10Shown: oldestShown, bannerBreached: banner, truncationNoticeShown: note };
    console.log(path, JSON.stringify(out[path]));
  }
  saveJson(process.env.OUT || 'admin-queue.json', out);
})().finally(() => db.$disconnect());
