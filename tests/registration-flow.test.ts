/**
 * ═══════════════════════════════════════════════════════════
 * ★★★ রেজিস্ট্রেশন → OTP → যাচাই → লগইন — পূর্ণ পথ
 *
 *   `otp.test.ts` কোড-যাচাইয়ের যান্ত্রিক অংশ প্রমাণ করে (মেয়াদ,
 *   চেষ্টা-সীমা, হ্যাশ, পুনঃব্যবহার)। এই ফাইলটি তার **চারপাশের**
 *   অংশটুকু ধরে, যা এতদিন অপরীক্ষিত ছিল:
 *
 *     ১. ইনপুট-ভ্যালিডেশন — দুর্বল পাসওয়ার্ড, ভাঙা ফোন, ছোট নাম
 *     ২. ডুপ্লিকেট ইমেইল ও ডুপ্লিকেট ফোন — আলাদা বার্তা, ৪০৯
 *     ৩. রেফারেল কোড — অবৈধ ও **ব্যান করা** রেফারার
 *     ৪. যাচাইয়ের **পরে সত্যিই লগইন হয়** (শেষ কড়িটি)
 *     ৫. রেজিস্ট্রেশনের রেট-লিমিট সত্যিই কামড়ায়
 *
 *   ⚠️ কোনো ইমেইল সত্যিই পাঠানো হয় না — টেস্ট-পরিবেশে
 *   `RESEND_API_KEY` নেই। কোডটি আসল `issueOtp()` দিয়ে বানিয়ে DB
 *   থেকেই নেওয়া হয়, অর্থাৎ **ডেলিভারি ছাড়া বাকি পুরো পথ** পরীক্ষিত।
 *   ডেলিভারি নিজে বাহ্যিক নির্ভরতা (HANDOFF §১)।
 * ═══════════════════════════════════════════════════════════
 */
import { describe, it, expect, vi } from 'vitest';
import { db } from '../vitest.setup';
import { client } from './helpers/app';
import { createUser } from './helpers/factories';
import { issueOtp } from '../src/lib/otp/core';

const PASSWORD = 'Test1234';

function form(over: Record<string, unknown> = {}) {
  const tag = Math.random().toString(36).slice(2, 8);
  return {
    name: 'রেজিস্টার পরীক্ষা',
    email: `reg-${tag}@test.local`,
    phone: `014${Math.floor(10_000_000 + Math.random() * 89_999_999)}`,
    password: PASSWORD,
    ...over,
  };
}

async function codeFor(email: string) {
  const { code } = await issueOtp({
    channel: 'EMAIL', purpose: 'REGISTER', destination: email, ip: '127.0.0.1',
  });
  return code;
}

/** কোডসহ পূর্ণ সাইনআপ — সফল হওয়ার কথা */
async function signUp(over: Record<string, unknown> = {}) {
  const f = form(over);
  const code = await codeFor(f.email as string);
  const res = await client().post('/api/register', { ...f, code });
  return { f, res };
}

describe('রেজিস্ট্রেশন — ইনপুট যাচাই', () => {
  it('দুর্বল পাসওয়ার্ড প্রত্যাখ্যাত, অ্যাকাউন্ট তৈরি হয় না', async () => {
    const f = form({ password: 'password' });
    const res = await client().post('/api/register', { ...f, code: await codeFor(f.email as string) });
    expect(res.status).toBe(400);
    expect(await db.user.count({ where: { email: f.email as string } })).toBe(0);
  });

  it('সংখ্যা ছাড়া পাসওয়ার্ড প্রত্যাখ্যাত', async () => {
    const f = form({ password: 'onlyletters' });
    const res = await client().post('/api/register', { ...f, code: await codeFor(f.email as string) });
    expect(res.status).toBe(400);
  });

  it('৮ অক্ষরের কম পাসওয়ার্ড প্রত্যাখ্যাত', async () => {
    const f = form({ password: 'Ab1' });
    const res = await client().post('/api/register', { ...f, code: await codeFor(f.email as string) });
    expect(res.status).toBe(400);
  });

  it('বাংলাদেশি নয় এমন ফোন নাম্বার প্রত্যাখ্যাত', async () => {
    const f = form({ phone: '01212345678' });
    const res = await client().post('/api/register', { ...f, code: await codeFor(f.email as string) });
    expect(res.status).toBe(400);
    expect(await db.user.count({ where: { email: f.email as string } })).toBe(0);
  });

  it('খুব ছোট নাম প্রত্যাখ্যাত', async () => {
    const f = form({ name: 'ক' });
    const res = await client().post('/api/register', { ...f, code: await codeFor(f.email as string) });
    expect(res.status).toBe(400);
  });

  it('অবৈধ ইমেইল প্রত্যাখ্যাত', async () => {
    const res = await client().post('/api/register', { ...form({ email: 'not-an-email' }), code: '123456' });
    expect(res.status).toBe(400);
  });
});

describe('রেজিস্ট্রেশন — ডুপ্লিকেট', () => {
  it('একই ইমেইলে দ্বিতীয় অ্যাকাউন্ট হয় না (৪০৯), দ্বিতীয় সারিও নয়', async () => {
    const { f, res } = await signUp();
    expect(res.status).toBe(200);

    const dup = form({ email: f.email });
    const res2 = await client().post('/api/register', { ...dup, code: await codeFor(dup.email as string) });
    expect(res2.status).toBe(409);
    expect(await db.user.count({ where: { email: f.email as string } })).toBe(1);
  });

  it('একই ফোনে দ্বিতীয় অ্যাকাউন্ট হয় না, আর বার্তাটি ফোন-নির্দিষ্ট', async () => {
    const { f, res } = await signUp();
    expect(res.status).toBe(200);

    const dup = form({ phone: f.phone });
    const res2 = await client().post('/api/register', { ...dup, code: await codeFor(dup.email as string) });
    expect(res2.status).toBe(409);
    expect(String(res2.body?.error ?? '')).toContain('মোবাইল');
    expect(await db.user.count({ where: { phone: f.phone as string } })).toBe(1);
  });
});

describe('রেজিস্ট্রেশন — রেফারেল কোড', () => {
  it('অবৈধ রেফারেল কোডে অ্যাকাউন্ট তৈরি হয় না', async () => {
    const f = form({ referralCode: 'NOSUCHCODE' });
    const res = await client().post('/api/register', { ...f, code: await codeFor(f.email as string) });
    expect(res.status).toBe(400);
    expect(await db.user.count({ where: { email: f.email as string } })).toBe(0);
  });

  it('ব্যান করা রেফারারের কোড গ্রহণ করা হয় না', async () => {
    const banned = await createUser(db, { isBanned: true });
    const f = form({ referralCode: banned.referralCode });
    const res = await client().post('/api/register', { ...f, code: await codeFor(f.email as string) });
    expect(res.status).toBe(400);
    expect(await db.user.count({ where: { email: f.email as string } })).toBe(0);
  });

  it('বৈধ কোডে referredById বসে', async () => {
    const referrer = await createUser(db);
    const { f, res } = await signUp({ referralCode: referrer.referralCode });
    expect(res.status).toBe(200);
    const created = await db.user.findUnique({
      where: { email: f.email as string }, select: { referredById: true },
    });
    expect(created?.referredById).toBe(referrer.id);
  });
});

describe('রেজিস্ট্রেশন — যাচাইয়ের পরে লগইন (শেষ কড়ি)', () => {
  it('OTP দিয়ে তৈরি অ্যাকাউন্টে সত্যিই লগইন হয়, আর সেশন কাজ করে', async () => {
    const { f, res } = await signUp();
    expect(res.status).toBe(200);

    const created = await db.user.findUnique({
      where: { email: f.email as string }, select: { emailVerified: true, role: true },
    });
    expect(created?.emailVerified).toBe(true);
    expect(created?.role).toBe('USER');

    const c = client();
    expect(await c.login(f.email as string, PASSWORD)).toBe(true);

    const me = await c.get('/api/auth/session');
    expect(me.status).toBe(200);
    expect(JSON.stringify(me.body)).toContain(f.email as string);
  });

  it('ভুল পাসওয়ার্ডে লগইন হয় না', async () => {
    const { f } = await signUp();
    expect(await client().login(f.email as string, 'WrongPass123')).toBe(false);
  });
});

describe('রেজিস্ট্রেশন — রেট-লিমিট', () => {
  it('একই IP থেকে বারবার চেষ্টা করলে ৪২৯ আসে', async () => {
    let sawLimited = false;
    for (let i = 0; i < 8; i++) {
      const f = form({ password: 'weak' });
      const r = await client().post('/api/register', { ...f, code: '123456' });
      if (r.status === 429) { sawLimited = true; break; }
    }
    expect(sawLimited).toBe(true);
  });
});

/**
 * ═══════════════════════════════════════════════════════════
 * ★★★ ইমেইল-ডেলিভারির কনফিগ — "সবুজ দেখাচ্ছে কিন্তু ভাঙা" ধরা
 *
 *   বাহ্যিক নির্ভরতা (Resend) স্থানীয়ভাবে চালানো যায় না, কিন্তু
 *   **আমাদের দিকের সিদ্ধান্তটি** পুরোপুরি পরীক্ষাযোগ্য: কী থাকা
 *   সত্ত্বেও প্রেরক স্যান্ডবক্স হলে সিস্টেম সেটিকে **অচল** বলবে,
 *   `up` নয়। আগে বলত না — তাই ভাঙা রেজিস্ট্রেশন-ফানেল কোনো
 *   ড্যাশবোর্ডে ধরা পড়ত না।
 * ═══════════════════════════════════════════════════════════
 */
describe('ইমেইল কনফিগ — স্যান্ডবক্স প্রেরক ধরা পড়ে', () => {
  it('EMAIL_FROM স্যান্ডবক্স হলে isSandboxSender() true', async () => {
    vi.resetModules();
    vi.stubEnv('RESEND_API_KEY', 're_test_key_not_real');
    vi.stubEnv('EMAIL_FROM', 'SS UID TOPUP <onboarding@resend.dev>');
    const m = await import('../src/lib/email');
    expect(m.isEmailConfigured()).toBe(true);
    expect(m.isSandboxSender()).toBe(true);
    vi.unstubAllEnvs();
  });

  it('নিজের ডোমেইনে প্রেরক হলে isSandboxSender() false', async () => {
    vi.resetModules();
    vi.stubEnv('RESEND_API_KEY', 're_test_key_not_real');
    vi.stubEnv('EMAIL_FROM', 'SS UID TOPUP <no-reply@uidtopup.com>');
    const m = await import('../src/lib/email');
    expect(m.isSandboxSender()).toBe(false);
    vi.unstubAllEnvs();
  });

  it('EMAIL_FROM সেট না থাকলে ডিফল্টই স্যান্ডবক্স — অর্থাৎ ধরা পড়ে', async () => {
    vi.resetModules();
    vi.stubEnv('RESEND_API_KEY', 're_test_key_not_real');
    vi.stubEnv('EMAIL_FROM', '');
    const m = await import('../src/lib/email');
    expect(m.isSandboxSender()).toBe(true);
    vi.unstubAllEnvs();
  });

  it('হেলথ-চেক স্যান্ডবক্স প্রেরককে down বলে, up নয়', async () => {
    vi.resetModules();
    vi.stubEnv('RESEND_API_KEY', 're_test_key_not_real');
    vi.stubEnv('EMAIL_FROM', 'SS UID TOPUP <onboarding@resend.dev>');
    const h = await import('../src/lib/health');
    const sys = await h.getSystemHealth();
    const email = sys.subsystems.find((s) => s.key === 'email');
    expect(email?.state).toBe('down');
    expect(email?.detail ?? '').toContain('resend.dev');
    // ★ তবু critical নয় — /api/health যেন ৫০৩ দিয়ে লোড-ব্যালান্সার না ফেলে
    expect(email?.critical).toBe(false);
    expect(sys.status).toBe('ok');
    vi.unstubAllEnvs();
  });
});
