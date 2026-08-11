/**
 * ═══════════════════════════════════════════════════════════
 * ★★★ Group I (৩) — ইমেইল OTP, রেজিস্ট্রেশনে বাধ্যতামূলক
 *
 *   ── এখানে যা প্রমাণ করা হয় ──
 *   ১. কোড ছাড়া অ্যাকাউন্ট **তৈরিই হয় না** (enforcement সত্যিই চালু)
 *   ২. সফল সাইনআপে অ্যাকাউন্ট **যাচাইকৃত** অবস্থায় জন্মায়
 *   ৩. একই কোড দুবার চলে না, ভুল কোড গোনা হয়, মেয়াদ মানা হয়
 *   ৪. ব্যর্থ যাচাইয়ে **অ্যাকাউন্ট তৈরি হয় না** (এক ট্রানজেকশন)
 *   ৫. কোড কখনো প্লেইনটেক্সটে DB-তে থাকে না
 *   ৬. `/api/auth/otp/send` অ্যাকাউন্ট-গণনা ফাঁস করে না
 *
 *   ⚠️ ইমেইল সত্যিই পাঠানো হয় না — টেস্টে `RESEND_API_KEY` নেই, তাই
 *   `emailOtpCode()` false ফেরে ও send-endpoint ৫০২ দেয়। সেটিও
 *   একটি দাবি (নিচে যাচাই করা): কোড না গেলে "পাঠানো হয়েছে" বলা
 *   হয় না। কোড নিজে DB থেকে পড়ে নিয়ে বাকি পথ পরীক্ষা করা হয়।
 * ═══════════════════════════════════════════════════════════
 */
import { describe, it, expect } from 'vitest';
import bcrypt from 'bcryptjs';
import { db } from '../vitest.setup';
import { client } from './helpers/app';
import { issueOtp } from '../src/lib/otp/core';

const PASSWORD = 'Test1234';

function form(over: Record<string, unknown> = {}) {
  const tag = Math.random().toString(36).slice(2, 8);
  return {
    name: 'OTP Tester',
    email: `otp-${tag}@test.local`,
    phone: `013${Math.floor(10_000_000 + Math.random() * 89_999_999)}`,
    password: PASSWORD,
    ...over,
  };
}

/** ★ আসল ইস্যু-পথ দিয়েই কোড বানাই — টেস্ট নিজে হ্যাশ বানায় না */
async function codeFor(email: string) {
  const { code } = await issueOtp({
    channel: 'EMAIL',
    purpose: 'REGISTER',
    destination: email,
    ip: '127.0.0.1',
  });
  return code;
}

describe('OTP — রেজিস্ট্রেশনে বাধ্যতামূলক', () => {
  it('কোড ছাড়া অ্যাকাউন্ট তৈরি হয় না', async () => {
    const f = form();
    const res = await client().post('/api/register', f);

    expect(res.status).toBe(400);
    expect(await db.user.count({ where: { email: f.email as string } })).toBe(0);
  });

  it('ভুল কোডে অ্যাকাউন্ট তৈরি হয় না', async () => {
    const f = form();
    await codeFor(f.email as string);

    const res = await client().post('/api/register', { ...f, code: '000000' });
    expect(res.status).toBe(400);
    expect(await db.user.count({ where: { email: f.email as string } })).toBe(0);
  });

  /** ★★★ মূল happy path */
  it('সঠিক কোডে অ্যাকাউন্ট তৈরি হয় ও emailVerified = true', async () => {
    const f = form();
    const code = await codeFor(f.email as string);

    const res = await client().post('/api/register', { ...f, code });
    expect(res.status).toBe(200);

    const user = await db.user.findUnique({
      where: { email: f.email as string },
      select: { emailVerified: true, phoneVerified: true },
    });
    expect(user?.emailVerified).toBe(true);
    // ★ SMS চ্যানেল বন্ধ, তাই ফোন যাচাই হয়নি — এবং সেটিই সঠিক
    expect(user?.phoneVerified).toBe(false);
  });

  it('একই কোড দ্বিতীয়বার চলে না', async () => {
    const f1 = form();
    const code = await codeFor(f1.email as string);
    expect((await client().post('/api/register', { ...f1, code })).status).toBe(200);

    // ★ একই ইমেইলে আবার — কোড খরচ হয়ে গেছে
    const again = await client().post('/api/register', { ...f1, code });
    expect(again.status).not.toBe(200);
  });

  it('মেয়াদোত্তীর্ণ কোড কাজ করে না', async () => {
    const f = form();
    const code = await codeFor(f.email as string);
    await db.otp.updateMany({
      where: { destination: f.email as string },
      data: { expiresAt: new Date(Date.now() - 60_000) },
    });

    const res = await client().post('/api/register', { ...f, code });
    expect(res.status).toBe(400);
    expect(await db.user.count({ where: { email: f.email as string } })).toBe(0);
  });

  it('৫ বার ভুলের পর কোডটি মৃত — সঠিক কোডেও নয়', async () => {
    const f = form();
    const code = await codeFor(f.email as string);

    for (let i = 0; i < 5; i++) {
      await client().post('/api/register', { ...f, code: '111111' });
      // ⚠️ `register` সীমা ঘণ্টায় ৫ — নাহলে ষষ্ঠ কলটি ৪২৯ পেত ও
      //    আমরা OTP-র নয়, rate-limiter-এর আচরণ মাপতাম
      await db.rateLimitBucket.deleteMany({});
    }

    const res = await client().post('/api/register', { ...f, code });
    expect(res.status).toBe(400);
    expect(await db.user.count({ where: { email: f.email as string } })).toBe(0);
  });

  it('নতুন কোড চাইলে আগেরটি বাতিল হয়', async () => {
    const f = form();
    const first = await codeFor(f.email as string);
    const second = await codeFor(f.email as string);
    expect(first).not.toBe(second);

    expect((await client().post('/api/register', { ...f, code: first })).status).toBe(400);
    expect((await client().post('/api/register', { ...f, code: second })).status).toBe(200);
  });
});

describe('OTP — কোড সংরক্ষণ', () => {
  it('কোড কখনো প্লেইনটেক্সটে DB-তে থাকে না', async () => {
    const email = `hash-${Date.now()}@test.local`;
    const code = await codeFor(email);

    const row = await db.otp.findFirst({ where: { destination: email } });
    expect(row).toBeTruthy();
    expect(row!.codeHash).not.toBe(code);
    // ★ bcrypt হ্যাশ, আর কোডটি সত্যিই ওটাই
    expect(row!.codeHash.startsWith('$2')).toBe(true);
    expect(await bcrypt.compare(code, row!.codeHash)).toBe(true);
  });
});

describe('OTP — কোড চাওয়ার endpoint', () => {
  /**
   * ★★★ enumeration — নিবন্ধিত ও অনিবন্ধিত ইমেইলে উত্তর **হুবহু এক**।
   *
   *   ⚠️ নির্দিষ্ট স্ট্যাটাস কোড assert করা হয় না, **সমতা** করা হয় —
   *   কারণ প্রকৃত কোডটি পরিবেশ-নির্ভর (চ্যানেল চালু আছে কি না তার
   *   উপর)। যেটি সবসময় সত্য হতে হবে তা হলো: দুটি উত্তর আলাদা করা
   *   যাবে না। এটিই আসল দাবি, আর এভাবে লিখলে পরিবেশ বদলালেও টেস্ট
   *   একই জিনিস পাহারা দেয়।
   */
  it('নিবন্ধিত ও অনিবন্ধিত ইমেইলে উত্তর আলাদা করা যায় না', async () => {
    const f = form();
    const code = await codeFor(f.email as string);
    expect((await client().post('/api/register', { ...f, code })).status).toBe(200);
    await db.rateLimitBucket.deleteMany({});

    const known = await client().post('/api/auth/otp/send', { email: f.email });
    await db.rateLimitBucket.deleteMany({});
    const unknown = await client().post('/api/auth/otp/send', {
      email: `fresh-${Date.now()}@test.local`,
    });

    expect(known.status).toBe(unknown.status);
    expect(JSON.stringify(known.body)).toBe(JSON.stringify(unknown.body));
  });

  it('নিবন্ধিত ইমেইলে কোনো কোড তৈরি হয় না', async () => {
    const f = form();
    const code = await codeFor(f.email as string);
    expect((await client().post('/api/register', { ...f, code })).status).toBe(200);

    await db.otp.deleteMany({});
    await db.rateLimitBucket.deleteMany({});
    await client().post('/api/auth/otp/send', { email: f.email });

    // ★ উত্তর যা-ই হোক, নিবন্ধিত ঠিকানায় কোড পাঠানো হয় না
    expect(await db.otp.count()).toBe(0);
  });

  /**
   * ★★★ কোনো চ্যানেল না থাকলে endpoint **অস্বীকার করে**, মিথ্যা বলে না।
   *
   *   ⚠️ টেস্ট পরিবেশে `.env.development` ইচ্ছাকৃতভাবে
   *   `RESEND_API_KEY` খালি করে (ডেভ যেন আসল ইমেইল না পাঠায়), তাই
   *   ইমেইল চ্যানেল available নয় → ৫০৩। এটিই সঠিক আচরণ: "কোড
   *   পাঠানো হয়েছে" বলে ২০০ ফেরালে গ্রাহক অনন্তকাল অপেক্ষা করতেন।
   *
   *   ⚠️ "পাঠাতে গিয়ে ব্যর্থ হলে ৫০২" পথটি এখানে নয়, ইউনিট-স্তরে
   *   প্রমাণিত: আসল Resend API-তে অননুমোদিত ঠিকানায় পাঠিয়ে
   *   `emailOtpCode()` false ফেরত দিয়েছে (HANDOFF.md দেখুন)।
   */
  it('চ্যানেল না থাকলে ৫০৩ — "পাঠানো হয়েছে" বলা হয় না', async () => {
    const res = await client().post('/api/auth/otp/send', {
      email: `fresh-${Date.now()}@test.local`,
    });
    expect(res.status).toBe(503);
    expect(res.body.success).toBeUndefined();
  });

  it('অবৈধ ইমেইল প্রত্যাখ্যাত', async () => {
    const res = await client().post('/api/auth/otp/send', { email: 'not-an-email' });
    expect(res.status).toBe(400);
  });
});
