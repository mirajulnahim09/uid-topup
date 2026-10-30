/**
 * ═══════════════════════════════════════════════════════════
 * ★★★ OPS-01 — সবাইকে ঘোষণা: ব্যাচ · requestId idempotency · সীমা · safeUrl
 *
 *   আসল HTTP, আসল অ্যাডমিন-সেশন। প্রতিটি দাবি DB গুনে যাচাই:
 *   "প্রত্যেক ইউজার ঠিক একটি নোটিফিকেশন পান" — ব্যাচের সীমা পেরিয়েও,
 *   একই অনুরোধ পুনরায় বা সমান্তরালে এলেও।
 * ═══════════════════════════════════════════════════════════
 */
import { describe, it, expect } from 'vitest';
import { randomUUID } from 'crypto';
import { db } from '../vitest.setup';
import { signedInAdmin, signedInUser } from './helpers/app';

const TITLE = 'ঈদ অফার';

/** ★ ব্যাচ-সীমা (১০০০) পেরোতে দ্রুত অনেক ইউজার — লগইন লাগে না, তাই bcrypt নয় */
async function bulkUsers(n: number) {
  const tag = randomUUID().slice(0, 8);
  await db.user.createMany({
    data: Array.from({ length: n }, (_, i) => ({
      email: `bulk${tag}${i}@test.local`,
      name: `Bulk ${i}`,
      phone: `017${tag.replace(/\D/g, '').padEnd(2, '0').slice(0, 2)}${String(i).padStart(6, '0')}`,
      password: 'x',
      referralCode: `B${tag}${i}`.slice(0, 16).toUpperCase(),
    })),
  });
}

/** প্রত্যেক ইউজারের এই ঘোষণার নোটিফিকেশন-সংখ্যা: {০ পাওয়া, >১ পাওয়া} */
async function perUserCounts(title = TITLE) {
  const users = await db.user.findMany({ select: { id: true } });
  const grouped = await db.notification.groupBy({
    by: ['userId'],
    where: { title: `📢 ${title}` },
    _count: { _all: true },
  });
  const byUser = new Map(grouped.map((g) => [g.userId, g._count._all]));
  return {
    users: users.length,
    missing: users.filter((u) => !byUser.get(u.id)).length,
    dup: [...byUser.values()].filter((c) => c > 1).length,
  };
}

describe('OPS-01 — ব্যাচ ও idempotency', () => {
  it('ব্যাচ-সীমা পেরিয়ে সবাই ঠিক একবার পায়; একই requestId আবার এলে নতুন করে পাঠায় না', async () => {
    const { client: adm } = await signedInAdmin(db);
    await bulkUsers(1203);
    const requestId = randomUUID();
    const payload = { title: TITLE, body: 'সব প্যাকেজে ছাড়', requestId };

    const r1 = await adm.post<{ count: number; duplicate: boolean }>('/api/admin/announce', payload);
    expect(r1.status).toBe(200);
    const c = await perUserCounts();
    expect(c.users).toBeGreaterThan(1000);
    expect(r1.body.count).toBe(c.users);
    expect(r1.body.duplicate).toBe(false);
    expect(c.missing).toBe(0);
    expect(c.dup).toBe(0);

    const r2 = await adm.post<{ count: number; duplicate: boolean }>('/api/admin/announce', payload);
    expect(r2.status).toBe(200);
    expect(r2.body.duplicate).toBe(true);
    expect(r2.body.count).toBe(c.users);
    expect(await db.notification.count({ where: { title: `📢 ${TITLE}` } })).toBe(c.users);
  });

  it('একই requestId সমান্তরালে ৪ বার — তবু প্রত্যেকে ঠিক একবার', async () => {
    const { client: adm } = await signedInAdmin(db);
    await bulkUsers(1500);
    const payload = { title: TITLE, body: 'ডাবল-ক্লিক', requestId: randomUUID() };
    const rs = await Promise.all(Array.from({ length: 4 }, () => adm.post('/api/admin/announce', payload)));
    expect(rs.map((r) => r.status)).toEqual([200, 200, 200, 200]);
    const c = await perUserCounts();
    expect(c.missing).toBe(0);
    expect(c.dup).toBe(0);
  });

  it('একই requestId-এ ভিন্ন বার্তা → ৪০৯, কিছু পাঠানো হয় না', async () => {
    const { client: adm } = await signedInAdmin(db);
    const requestId = randomUUID();
    expect((await adm.post('/api/admin/announce', { title: TITLE, body: 'এক', requestId })).status).toBe(200);
    const before = await db.notification.count();
    const r = await adm.post('/api/admin/announce', { title: TITLE, body: 'দুই', requestId });
    expect(r.status).toBe(409);
    expect(await db.notification.count()).toBe(before);
  });

  it('requestId ছাড়া → ৪০০, কিছু পাঠানো হয় না', async () => {
    const { client: adm } = await signedInAdmin(db);
    const r = await adm.post('/api/admin/announce', { title: TITLE, body: 'x' });
    expect(r.status).toBe(400);
    expect(await db.notification.count()).toBe(0);
  });
});

describe('OPS-01 — safeUrl', () => {
  it.each(['javascript:alert(1)', '//evil.example', 'data:text/html,x'])('অনিরাপদ লিংক %s → ৪০০', async (link) => {
    const { client: adm } = await signedInAdmin(db);
    const r = await adm.post('/api/admin/announce', { title: TITLE, body: 'x', link, requestId: randomUUID() });
    expect(r.status).toBe(400);
    expect(await db.notification.count()).toBe(0);
  });

  it('নিরাপদ লিংক (/faq, https://…) সংরক্ষিত হয়', async () => {
    const { client: adm } = await signedInAdmin(db);
    for (const link of ['/faq', 'https://example.com/offer']) {
      const r = await adm.post('/api/admin/announce', { title: TITLE, body: link, link, requestId: randomUUID() });
      expect(r.status).toBe(200);
      const n = await db.notification.findFirst({ where: { body: link } });
      expect(n?.link).toBe(link);
    }
  });
});

describe('OPS-01 — সীমা ও অধিকার', () => {
  it('প্রতি অ্যাডমিনে ঘণ্টায় ৫টি নতুন ঘোষণা; ৬ষ্ঠটি ৪২৯ — কিন্তু পুরনো requestId-এর পুনরাবৃত্তি চলে', async () => {
    const { client: adm } = await signedInAdmin(db);
    const ids = Array.from({ length: 6 }, () => randomUUID());
    for (let i = 0; i < 5; i++) {
      const r = await adm.post('/api/admin/announce', { title: `${TITLE} ${i}`, body: 'x', requestId: ids[i] });
      expect(r.status).toBe(200);
    }
    const sixth = await adm.post('/api/admin/announce', { title: `${TITLE} 5`, body: 'x', requestId: ids[5] });
    expect(sixth.status).toBe(429);
    expect(await db.notification.count({ where: { title: `📢 ${TITLE} 5` } })).toBe(0);

    const replay = await adm.post<{ duplicate: boolean }>('/api/admin/announce', { title: `${TITLE} 0`, body: 'x', requestId: ids[0] });
    expect(replay.status).toBe(200);
    expect(replay.body.duplicate).toBe(true);
  });

  it('সাধারণ ইউজার পাঠাতে পারেন না', async () => {
    const { client: c } = await signedInUser(db);
    const r = await c.post('/api/admin/announce', { title: TITLE, body: 'x', requestId: randomUUID() });
    expect([401, 403]).toContain(r.status);
    expect(await db.notification.count()).toBe(0);
  });
});
