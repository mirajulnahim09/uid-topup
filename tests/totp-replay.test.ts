/**
 * ═══════════════════════════════════════════════════════════
 * ★★★ AUTH-06 — TOTP replay-রোধ
 *
 *   আগে একটি বৈধ কোড ±১ ধাপে প্রায় ৯০ সেকেন্ড বারবার চলত। দাবি (আসল HTTP লগইন):
 *     · একই কোডে দ্বিতীয় লগইন ব্যর্থ; একসাথে দুটি লগইনে ঠিক একটি সফল
 *     · ±১ ধাপ ঘড়ি-পার্থক্য আগের মতোই কাজ করে (সামনের ধাপ গ্রহণযোগ্য)
 *     · ভুল কোড কোনো ধাপ খরচ করে না
 *     · ব্যবহৃত কোডে 2FA বন্ধ করা যায় না
 *   ⚠️ ৩০s ধাপ-সীমানায় অনিশ্চয়তা এড়াতে প্রতিটি টেস্ট ধাপের শুরুর দিকে চলে।
 * ═══════════════════════════════════════════════════════════
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { db } from '../vitest.setup';
import { client, signedInUser } from './helpers/app';
import { DEFAULT_PASSWORD } from './helpers/factories';
import { generateTotp, matchTotpStep, verifyTotp } from '../src/lib/totp';
import { claimTotpStep } from '../src/lib/totpReplay';

const STEP_MS = 30_000;
const at = (offsetSteps: number) => Date.now() + offsetSteps * STEP_MS;

/** ধাপের শেষ ১০ সেকেন্ডে থাকলে পরের ধাপ পর্যন্ত অপেক্ষা */
beforeEach(async () => {
  const into = Date.now() % STEP_MS;
  if (into > STEP_MS - 10_000) await new Promise((r) => setTimeout(r, STEP_MS - into + 200));
});

/** আসল API দিয়ে 2FA চালু — enable কোডটি নির্দিষ্ট ধাপের (সেটিও খরচ হয়) */
async function with2fa(enableStepOffset: number) {
  const signed = await signedInUser(db);
  const setup = await signed.client.post<{ secret: string }>('/api/account/2fa', { action: 'setup' });
  expect(setup.status).toBe(200);
  const secret = setup.body.secret;
  const en = await signed.client.post('/api/account/2fa', {
    action: 'enable', password: DEFAULT_PASSWORD, secret, token: generateTotp(secret, at(enableStepOffset)),
  });
  expect(en.status).toBe(200);
  return { ...signed, secret };
}

describe('AUTH-06 — ইউনিট', () => {
  it('matchTotpStep মেলা ধাপ দেয়; ±১-এর বাইরে null; verifyTotp আগের মতোই', () => {
    const secret = 'JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP';
    const now = Date.now();
    const step = Math.floor(now / STEP_MS);
    expect(matchTotpStep(secret, generateTotp(secret, now), { atMs: now })).toBe(step);
    expect(matchTotpStep(secret, generateTotp(secret, now + STEP_MS), { atMs: now })).toBe(step + 1);
    expect(matchTotpStep(secret, generateTotp(secret, now - STEP_MS), { atMs: now })).toBe(step - 1);
    expect(matchTotpStep(secret, generateTotp(secret, now + 2 * STEP_MS), { atMs: now })).toBeNull();
    expect(matchTotpStep(secret, 'abcdef', { atMs: now })).toBeNull();
    expect(verifyTotp(secret, generateTotp(secret, now), { atMs: now })).toBe(true);
  });

  it('claimTotpStep: একই/আগের ধাপ false, পরের ধাপ true; সমান্তরালে একটিই জেতে', async () => {
    const u = await db.user.create({ data: { email: 'claim@test.local', name: 'c', phone: '01800000001', password: 'x', referralCode: 'CLAIM1' } });
    expect(await claimTotpStep(u.id, 1000)).toBe(true);
    expect(await claimTotpStep(u.id, 1000)).toBe(false);
    expect(await claimTotpStep(u.id, 999)).toBe(false);
    expect(await claimTotpStep(u.id, 1001)).toBe(true);
    const race = await Promise.all(Array.from({ length: 8 }, () => claimTotpStep(u.id, 1005)));
    expect(race.filter(Boolean)).toHaveLength(1);
  });
});

describe('AUTH-06 — আসল লগইন', () => {
  it('একই কোডে দ্বিতীয় লগইন ব্যর্থ; ঘড়ি-পার্থক্যের সামনের ধাপ তবু চলে', async () => {
    const { user, secret } = await with2fa(-1); // enable = আগের ধাপ (ঘড়ি পিছিয়ে)
    const code = generateTotp(secret, at(0));

    expect(await client().login(user.email, DEFAULT_PASSWORD, code)).toBe(true);
    expect(await client().login(user.email, DEFAULT_PASSWORD, code)).toBe(false); // replay

    // ঘড়ি সামনে থাকা ডিভাইসের পরের-ধাপের কোড — এখনো গ্রহণযোগ্য
    expect(await client().login(user.email, DEFAULT_PASSWORD, generateTotp(secret, at(1)))).toBe(true);
  });

  it('একই কোড নিয়ে দুটি লগইন একসাথে — ঠিক একটি সফল', async () => {
    const { user, secret } = await with2fa(-1);
    const code = generateTotp(secret, at(0));
    const r = await Promise.all([0, 1].map(() => client().login(user.email, DEFAULT_PASSWORD, code)));
    expect(r.filter(Boolean)).toHaveLength(1);
  });

  it('ভুল কোড কোনো ধাপ খরচ করে না', async () => {
    const { user, secret } = await with2fa(-1);
    const good = generateTotp(secret, at(0));
    const wrong = good === '000000' ? '111111' : '000000';
    expect(await client().login(user.email, DEFAULT_PASSWORD, wrong)).toBe(false);
    expect(await client().login(user.email, DEFAULT_PASSWORD, good)).toBe(true);
  });

  it('লগইনে ব্যবহৃত কোডে 2FA বন্ধ করা যায় না', async () => {
    const { user, secret, client: c } = await with2fa(-1);
    const code = generateTotp(secret, at(0));
    expect(await client().login(user.email, DEFAULT_PASSWORD, code)).toBe(true);

    const off = await c.post<{ error: string }>('/api/account/2fa', { action: 'disable', password: DEFAULT_PASSWORD, token: code });
    expect(off.status).toBe(400);
    expect(off.body.error).toContain('ইতিমধ্যে ব্যবহার');
    expect((await db.user.findUniqueOrThrow({ where: { id: user.id } })).twoFactorEnabled).toBe(true);
  });
});
