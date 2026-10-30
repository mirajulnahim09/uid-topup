/**
 * ═══════════════════════════════════════════════════════════
 * ★★★ AUTH-03 — 2FA প্রি-চেক ও লগইন: **একটিই** ব্রুট-ফোর্স বাজেট
 *
 *   আগে `/api/auth/2fa-check`-এর নিজস্ব বাকেট ছিল; 2FA-অ্যাকাউন্টে
 *   `needsTotp: true` = "পাসওয়ার্ড ঠিক", তাই আক্রমণকারী দুই দরজায় দ্বিগুণ অনুমান
 *   পেত। দাবি (আসল HTTP):
 *     · প্রি-চেকে ৫টি ভুল → সঠিক পাসওয়ার্ডেও লগইন আটকায় (এবং উল্টোটাও)
 *     · একটি ভুল চেষ্টা ঠিক একবার গোনা হয়; সঠিক পাসওয়ার্ডে কোনো খরচ থাকে না
 *     · বৈধ 2FA লগইন আগের মতোই চলে; অন্য ব্যবহারকারী প্রভাবিত হন না
 * ═══════════════════════════════════════════════════════════
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { db } from '../vitest.setup';
import { baseUrl, client, signedInUser } from './helpers/app';
import { DEFAULT_PASSWORD } from './helpers/factories';
import { generateTotp } from '../src/lib/totp';

const STEP_MS = 30_000;
beforeEach(async () => {
  const into = Date.now() % STEP_MS;
  if (into > STEP_MS - 10_000) await new Promise((r) => setTimeout(r, STEP_MS - into + 200));
});

async function with2fa() {
  const signed = await signedInUser(db);
  const setup = await signed.client.post<{ secret: string }>('/api/account/2fa', { action: 'setup' });
  const secret = setup.body.secret;
  const en = await signed.client.post('/api/account/2fa', {
    action: 'enable', password: DEFAULT_PASSWORD, secret, token: generateTotp(secret, Date.now() - STEP_MS),
  });
  expect(en.status).toBe(200);
  await db.rateLimitBucket.deleteMany({}); // সেটআপের লগইন বাজেট থেকে বাদ
  return { ...signed, secret };
}

async function precheck(email: string, password: string, ip = '203.0.113.10') {
  const r = await fetch(`${baseUrl()}/api/auth/2fa-check`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-real-ip': ip },
    body: JSON.stringify({ email, password }),
  });
  return (await r.json()) as { needsTotp: boolean; credentialsOk?: boolean };
}
const emailCount = async (email: string) =>
  (await db.rateLimitBucket.findUnique({ where: { key: `login:email:${email}` } }))?.count ?? 0;

describe('AUTH-03 — একটিই বাজেট', () => {
  it('প্রি-চেকে ৫টি ভুল → সঠিক পাসওয়ার্ড+কোডেও লগইন আটকায়; প্রি-চেক আর কিছু ফাঁস করে না', async () => {
    const { user, secret } = await with2fa();
    for (let i = 0; i < 5; i++) {
      expect(await precheck(user.email, `wrong-${i}`)).toEqual({ needsTotp: false, credentialsOk: false });
    }
    // ৬ষ্ঠ: সঠিক পাসওয়ার্ড — কিন্তু বাজেট শেষ, তাই oracle নয়
    expect(await precheck(user.email, DEFAULT_PASSWORD)).toEqual({ needsTotp: false });
    expect(await client().login(user.email, DEFAULT_PASSWORD, generateTotp(secret))).toBe(false);
  });

  it('উল্টোদিক: লগইনে ৫টি ভুল → প্রি-চেক সঠিক পাসওয়ার্ডেও needsTotp দেয় না', async () => {
    const { user } = await with2fa();
    for (let i = 0; i < 5; i++) expect(await client().login(user.email, `wrong-${i}`)).toBe(false);
    expect(await precheck(user.email, DEFAULT_PASSWORD)).toEqual({ needsTotp: false });
  });

  it('একটি ভুল প্রি-চেক ঠিক একবার গোনা; সঠিক পাসওয়ার্ডে খরচ ফেরত ও needsTotp', async () => {
    const { user } = await with2fa();
    await precheck(user.email, 'wrong-once');
    expect(await emailCount(user.email)).toBe(1);
    expect(await precheck(user.email, DEFAULT_PASSWORD)).toEqual({ needsTotp: true });
    expect(await emailCount(user.email)).toBe(1); // সফল প্রি-চেক বাজেট খায় না
  });

  it('বৈধ 2FA লগইন আগের মতোই: প্রি-চেক → কোড → সফল; বাকেট পরিষ্কার', async () => {
    const { user, secret } = await with2fa();
    expect(await precheck(user.email, DEFAULT_PASSWORD)).toEqual({ needsTotp: true });
    expect(await client().login(user.email, DEFAULT_PASSWORD, generateTotp(secret))).toBe(true);
    expect(await emailCount(user.email)).toBe(0);
  });

  it('2FA-বিহীন ব্যবহারকারী: সঠিক পাসওয়ার্ডে {needsTotp:false} (credentialsOk নেই), খরচ নেই', async () => {
    const { user } = await signedInUser(db);
    await db.rateLimitBucket.deleteMany({});
    expect(await precheck(user.email, DEFAULT_PASSWORD)).toEqual({ needsTotp: false });
    expect(await emailCount(user.email)).toBe(0);
  });

  it('এক ব্যবহারকারীর সীমা অন্যের ইমেইল-বাকেটে পড়ে না', async () => {
    const a = await with2fa();
    const b = await with2fa();
    for (let i = 0; i < 5; i++) await precheck(a.user.email, `wrong-${i}`, '203.0.113.21');
    expect(await precheck(b.user.email, DEFAULT_PASSWORD, '203.0.113.22')).toEqual({ needsTotp: true });
  });
});
