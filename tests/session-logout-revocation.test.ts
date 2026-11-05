/**
 * ═══════════════════════════════════════════════════════════
 * ★★★ AUTH-05 — লগআউট = কেবল এই সেশন/ডিভাইস বাতিল (সার্ভার-পক্ষে)
 *
 *   আগে লগআউট কেবল কুকি মুছত; কপি করা কুকি `/api/me`-তে ২০০ পেত (মাপা)। দাবি
 *   (আসল HTTP, আসল NextAuth signout):
 *     a) সেশন A লগআউট → A বাতিল
 *     b) একই ইউজারের সেশন B বৈধ থাকে (লগআউট ≠ সব-ডিভাইস)
 *     c) A-র কুকির কপি (লগআউটের আগে নেওয়া) → API ৪০১, পাতা লগইনে
 *     d) সব-ডিভাইস-সাইন-আউট আগের মতোই সবাইকে বাতিল করে
 *     e) পাসওয়ার্ড-রিসেট (অ্যাডমিন-রিকভারি) আগের নীতিতেই সবাইকে বাতিল করে
 *     · দৈনিক cleanup কেবল মেয়াদোত্তীর্ণ সারি মোছে
 * ═══════════════════════════════════════════════════════════
 */
import { describe, it, expect } from 'vitest';
import { db } from '../vitest.setup';
import { baseUrl, client, signedInAdmin, signedInUser } from './helpers/app';
import { DEFAULT_PASSWORD } from './helpers/factories';
import { TEST_CRON_SECRET, TEST_NEXTAUTH_SECRET } from './helpers/testEnv';
import { encode } from 'next-auth/jwt';
import { SESSION_COOKIE, type Client } from './helpers/http';

const jarOf = (c: unknown) => (c as { jar: Map<string, string> }).jar;
function copyOf(c: Client): Client {
  const x = client();
  for (const [k, v] of jarOf(c)) jarOf(x).set(k, v);
  return x;
}
async function logout(c: Client) {
  const csrf = (await c.get<{ csrfToken: string }>('/api/auth/csrf')).body.csrfToken;
  const r = await c.raw('/api/auth/signout', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ csrfToken: csrf, json: 'true' }),
  });
  expect(r.status).toBe(200);
}
async function pageSendsToLogin(c: Client, email: string) {
  const r = await c.raw('/account');
  const body = await r.text();
  const toLogin = ([303, 307, 308].includes(r.status) && (r.headers.get('location') || '').includes('/login'))
    || (r.status === 200 && body.includes('/login'));
  return toLogin && !body.includes(email);
}

describe('AUTH-05 — প্রতি-ডিভাইস লগআউট', () => {
  it('a+b+c: A লগআউট → A ও A-র কপি বাতিল (API ও পাতা); B বৈধ', async () => {
    const { user, client: a } = await signedInUser(db);
    const b = client();
    await b.loginOrThrow(user.email, DEFAULT_PASSWORD);
    const stolen = copyOf(a); // লগআউটের আগে চুরি

    expect((await stolen.get('/api/me')).status).toBe(200);
    await logout(a);

    expect((await a.get('/api/me')).status).toBe(401);
    expect((await stolen.get('/api/me')).status).toBe(401);
    expect(await pageSendsToLogin(stolen, user.email)).toBe(true);
    // টাকা-পথেও ঢোকা যায় না
    expect((await stolen.post('/api/order', { variantId: 1, playerUid: '123456789' })).status).toBe(401);

    expect((await b.get('/api/me')).status).toBe(200); // লগআউট ≠ সব-ডিভাইস
    expect(await db.revokedSession.count({ where: { userId: user.id } })).toBe(1);
    expect((await db.user.findUniqueOrThrow({ where: { id: user.id } })).sessionEpoch).toBe(0);
  });

  it('লগআউটের পর আবার লগইন — নতুন সেশন বৈধ', async () => {
    const { user, client: a } = await signedInUser(db);
    await logout(a);
    const again = client();
    await again.loginOrThrow(user.email, DEFAULT_PASSWORD);
    expect((await again.get('/api/me')).status).toBe(200);
  });

  it('d: সব-ডিভাইস-সাইন-আউট আগের মতোই সব সেশন বাতিল', async () => {
    const { user, client: a } = await signedInUser(db);
    const b = client();
    await b.loginOrThrow(user.email, DEFAULT_PASSWORD);
    expect((await a.post('/api/account/sessions/revoke-all', {})).status).toBe(200);
    expect((await a.get('/api/me')).status).toBe(401);
    expect((await b.get('/api/me')).status).toBe(401);
  });

  it('e: পাসওয়ার্ড-রিসেট (অ্যাডমিন-রিকভারি) আগের নীতিতেই সব সেশন বাতিল', async () => {
    const { user, client: a } = await signedInUser(db);
    const b = client();
    await b.loginOrThrow(user.email, DEFAULT_PASSWORD);
    const { client: adm } = await signedInAdmin(db);
    const link = await adm.post<{ url: string }>('/api/admin/user/recovery', { userId: user.id });
    const token = new URL(link.body.url).searchParams.get('token')!;
    expect((await client().post('/api/auth/reset', { token, password: 'Recovered2026x' })).status).toBe(200);
    expect((await a.get('/api/me')).status).toBe(401);
    expect((await b.get('/api/me')).status).toBe(401);
  });

  it('sid-বিহীন পুরনো কুকি (এই পরিবর্তনের আগের লগইন): চলে; একক লগআউটে আলাদা বাতিল হয় না; সব-ডিভাইসে হয়', async () => {
    const { user } = await signedInUser(db);
    // ★ পুরনো টোকেনের হুবহু আকার — `sid` দাবি নেই (জানা সীমাবদ্ধতা যাচাই)
    const legacy = await encode({
      token: { id: user.id, role: 'USER', epoch: 0, lastChecked: Date.now(), email: user.email, name: user.name },
      secret: TEST_NEXTAUTH_SECRET,
    });
    const c = client();
    jarOf(c).set(SESSION_COOKIE, legacy);
    const copy = copyOf(c);
    expect((await c.get('/api/me')).status).toBe(200);

    await logout(c);
    expect(await db.revokedSession.count({ where: { userId: user.id } })).toBe(0); // বাতিলের মতো sid নেই
    expect((await copy.get('/api/me')).status).toBe(200);                           // সীমাবদ্ধতা: কপি চলে

    await db.user.update({ where: { id: user.id }, data: { sessionEpoch: { increment: 1 } } }); // সব-ডিভাইস
    expect((await copy.get('/api/me')).status).toBe(401);
  });

  it('cleanup cron কেবল মেয়াদোত্তীর্ণ লগআউট-সারি মোছে; readiness-এ টেবিল-ব্লকার নেই', async () => {
    await db.revokedSession.createMany({
      data: [
        { sid: 'old-1', userId: 'u', expiresAt: new Date(Date.now() - 60_000) },
        { sid: 'live-1', userId: 'u', expiresAt: new Date(Date.now() + 60_000) },
      ],
    });
    const r = await fetch(`${baseUrl()}/api/cron/ratelimit-cleanup`, {
      method: 'POST', headers: { authorization: `Bearer ${TEST_CRON_SECRET}` },
    });
    expect(r.status).toBe(200);
    expect((await r.json()).revokedDeleted).toBe(1);
    expect((await db.revokedSession.findMany({ select: { sid: true } })).map((x) => x.sid)).toEqual(['live-1']);

    const { client: adm } = await signedInAdmin(db);
    const rd = await adm.get<{ blockers: string[] }>('/api/admin/readiness');
    expect(rd.body.blockers.some((b) => b.includes('RevokedSession'))).toBe(false);
  });
});
