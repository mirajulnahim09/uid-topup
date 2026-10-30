/**
 * ═══════════════════════════════════════════════════════════
 * ★★★ AUTH-04 — পাসওয়ার্ড বদলালে অন্য সব সেশন বাতিল, নিজেরটি টিকে থাকে
 *
 *   আগে কেবল hash বদলাত — অন্য ডিভাইসের (বা চুরি করা) কুকি ৩০ দিন চলত।
 *   এখানকার দাবি, আসল HTTP সেশনে:
 *     · অন্য সেশন ও এই কুকিরই পুরনো কপি → ৪০১
 *     · যিনি বদলালেন তিনি লগইনে থাকেন (সার্ভার নতুন epoch-এর কুকি দেয়)
 *     · ভুল বর্তমান পাসওয়ার্ডে কিছুই বদলায় না
 *     · পুরনো API কী বাতিল (রিসেট/সব-ডিভাইসের মতোই — মালিকের সিদ্ধান্ত); নতুন কী চলে
 * ═══════════════════════════════════════════════════════════
 */
import { describe, it, expect } from 'vitest';
import { db } from '../vitest.setup';
import { baseUrl, client, signedInUser } from './helpers/app';
import { DEFAULT_PASSWORD } from './helpers/factories';
import { generateApiKey } from '../src/lib/apiKey';

const NEW_PW = 'NewPass!2026xyz';
const jarOf = (c: unknown) => (c as { jar: Map<string, string> }).jar;

describe('AUTH-04 — পাসওয়ার্ড বদল ও সেশন', () => {
  it('অন্য সেশন ও পুরনো কুকির কপি ৪০১; বদলকারী লগইনে থাকেন', async () => {
    const { user, client: a } = await signedInUser(db);
    const b = client();
    await b.loginOrThrow(user.email, DEFAULT_PASSWORD);
    // ★ চুরি করা কুকির অনুকরণ: বদলের আগে A-র কুকির হুবহু কপি
    const stolen = client();
    for (const [k, v] of jarOf(a)) jarOf(stolen).set(k, v);

    expect((await b.get('/api/me')).status).toBe(200);
    expect((await stolen.get('/api/me')).status).toBe(200);

    const r = await a.post<{ keptSignedIn: boolean; signedOutOthers: boolean }>(
      '/api/account/password', { current: DEFAULT_PASSWORD, next: NEW_PW },
    );
    expect(r.status).toBe(200);
    expect(r.body.signedOutOthers).toBe(true);
    expect(r.body.keptSignedIn).toBe(true);

    expect((await a.get('/api/me')).status).toBe(200);      // বদলকারী টিকে থাকেন
    expect((await b.get('/api/me')).status).toBe(401);      // অন্য ডিভাইস বাতিল
    expect((await stolen.get('/api/me')).status).toBe(401); // পুরনো কুকির কপিও বাতিল

    // পাতা-গার্ডও একই নিয়মে — streaming-এর মাঝে redirect হলে Next ২০০ দিয়ে
    //   body-তে NEXT_REDIRECT পাঠায় (page-guard.test.ts-এর `sentTo`-র একই নিয়ম)
    const page = await b.raw('/account');
    const body = await page.text();
    const toLogin = ([303, 307, 308].includes(page.status) && (page.headers.get('location') || '').includes('/login'))
      || (page.status === 200 && body.includes('/login'));
    expect(toLogin).toBe(true);
    expect(body).not.toContain(user.email);

    // নতুন পাসওয়ার্ডে লগইন চলে, পুরনোতে নয়
    expect(await client().login(user.email, NEW_PW)).toBe(true);
    expect(await client().login(user.email, DEFAULT_PASSWORD)).toBe(false);
  });

  it('ভুল বর্তমান পাসওয়ার্ড → ৪০০; epoch ও অন্য সেশন অক্ষত', async () => {
    const { user, client: a } = await signedInUser(db);
    const b = client();
    await b.loginOrThrow(user.email, DEFAULT_PASSWORD);
    const before = (await db.user.findUniqueOrThrow({ where: { id: user.id } })).sessionEpoch;

    const r = await a.post('/api/account/password', { current: 'wrong-password-1', next: NEW_PW });
    expect(r.status).toBe(400);
    expect((await db.user.findUniqueOrThrow({ where: { id: user.id } })).sessionEpoch).toBe(before);
    expect((await b.get('/api/me')).status).toBe(200);
  });

  it('পাসওয়ার্ড বদলে পুরনো API কী বাতিল (৪০১); নতুন কী কাজ করে; অন্যের কী অক্ষত', async () => {
    const { user, client: a } = await signedInUser(db);
    const other = await signedInUser(db);
    await db.user.updateMany({ where: { id: { in: [user.id, other.user.id] } }, data: { tier: 'RESELLER' } });
    const mk = async (userId: string) => {
      const { plain, hash, prefix } = generateApiKey();
      const k = await db.apiKey.create({ data: { userId, label: 'k', prefix, hash } });
      return { plain, id: k.id };
    };
    // ★ বৈধ কী + খালি বডি → ৪০০ (প্রমাণীকরণ পেরিয়েছে); বাতিল কী → ৪০১ — কোনো অর্ডার হয় না
    const probe = async (key: string) => (await fetch(`${baseUrl()}/api/reseller/orders`, {
      method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${key}` }, body: '{}',
    })).status;

    const oldKey = await mk(user.id);
    const otherKey = await mk(other.user.id);
    expect(await probe(oldKey.plain)).toBe(400);

    const r = await a.post<{ revokedApiKeys: number }>('/api/account/password', { current: DEFAULT_PASSWORD, next: NEW_PW });
    expect(r.status).toBe(200);
    expect(r.body.revokedApiKeys).toBe(1);

    expect(await probe(oldKey.plain)).toBe(401);
    expect((await db.apiKey.findUniqueOrThrow({ where: { id: oldKey.id } })).revokedAt).not.toBeNull(); // মোছা নয়
    const fresh = await mk(user.id);
    expect(await probe(fresh.plain)).toBe(400);            // নতুন কী কাজ করে
    expect(await probe(otherKey.plain)).toBe(400);         // অন্যের কী অক্ষত
    expect((await db.apiKey.findUniqueOrThrow({ where: { id: otherKey.id } })).revokedAt).toBeNull();
  });
});
