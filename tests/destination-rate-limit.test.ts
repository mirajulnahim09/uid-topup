/**
 * ═══════════════════════════════════════════════════════════
 * ★★★ AUTH-07 — গন্তব্য-ভিত্তিক সীমা (রিসেট ও রেজিস্ট্রেশন-OTP)
 *
 *   আগে কেবল IP-সীমা — IP বদলে বদলে একজনের ইনবক্স ভরানো যেত। দাবি:
 *     · প্রতিটি অনুরোধে ভিন্ন IP দিলেও একই ইমেইলে সীমার বেশি পাঠানো হয় না
 *     · সীমা পেরোলেও উত্তর হুবহু এক (কোনো সংকেত/enumeration নয়)
 *     · অন্য ইমেইল প্রভাবিত হয় না (বিশ্বব্যাপী lockout নয়)
 *   রিসেট-মেইল stateless (DB-চিহ্ন নেই), আর টেস্ট-সার্ভারে OTP-চ্যানেল কনফিগহীন —
 *   তাই দুটো রুট-হ্যান্ডলারই টেস্ট-প্রসেসে চলে (টেস্ট DB), পাঠানোর ফাংশন নকল
 *   করে গোনা হয়; OTP-র ক্ষেত্রে DB-র `Otp` সারিও গোনা হয়।
 * ═══════════════════════════════════════════════════════════
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { db } from '../vitest.setup';
import { createUser } from './helpers/factories';

const sent = vi.hoisted(() => ({ reset: [] as string[], otp: [] as string[] }));
vi.mock('@/lib/email', async (orig) => ({
  ...(await orig<typeof import('../src/lib/email')>()),
  emailPasswordReset: vi.fn(async (to: string) => { sent.reset.push(to); }),
}));

// ★ টেস্ট-সার্ভারে ইমেইল চ্যানেল কনফিগহীন (৫০৩) — তাই একটি নকল চ্যানেল যা কেবল গোনে
vi.mock('@/lib/otp/channels', async (orig) => ({
  ...(await orig<typeof import('../src/lib/otp/channels')>()),
  signupChannels: vi.fn(async () => [{
    id: 'EMAIL',
    normalize: (v: string) => v.trim().toLowerCase(),
    deliver: vi.fn(async (to: string) => { sent.otp.push(to); return { ok: true }; }),
  }]),
}));

beforeEach(() => { sent.reset.length = 0; sent.otp.length = 0; });

async function otpSend(email: string, ip: string) {
  const { POST } = await import('../src/app/api/auth/otp/send/route');
  const res = await POST(new Request('http://t/api/auth/otp/send', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-real-ip': ip },
    body: JSON.stringify({ email }),
  }));
  return { status: res.status, body: await res.json() };
}

async function forgot(email: string, ip: string) {
  const { POST } = await import('../src/app/api/auth/forgot/route');
  const res = await POST(new Request('http://t/api/auth/forgot', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-real-ip': ip },
    body: JSON.stringify({ email }),
  }));
  return { status: res.status, body: await res.json() };
}

describe('AUTH-07 — রিসেট মেইল', () => {
  it('ভিন্ন ভিন্ন IP থেকেও একই ইমেইলে ঘণ্টায় ৩টির বেশি পাঠানো হয় না; উত্তর হুবহু এক', async () => {
    const u = await createUser(db);
    const answers = [];
    for (let i = 0; i < 6; i++) answers.push(await forgot(u.email, `198.51.100.${40 + i}`));
    expect(sent.reset).toHaveLength(3);
    for (const a of answers) expect(a).toEqual(answers[0]); // সীমা পেরোলেও একই ২০০ ও বার্তা
    expect(answers[0].status).toBe(200);
  });

  it('অন্য ইমেইল আটকায় না; অস্তিত্বহীন ইমেইলেও একই উত্তর', async () => {
    const a = await createUser(db);
    const b = await createUser(db);
    for (let i = 0; i < 4; i++) await forgot(a.email, `198.51.100.${60 + i}`);
    sent.reset.length = 0;
    const rb = await forgot(b.email, '198.51.100.70');
    expect(sent.reset).toEqual([b.email]);
    const ghost = await forgot('nobody-here@test.local', '198.51.100.71');
    expect(ghost).toEqual(rb);
  });
});

describe('AUTH-07 — রেজিস্ট্রেশন OTP', () => {
  it('ভিন্ন IP থেকেও একই গন্তব্যে ১৫ মিনিটে ৫টির বেশি কোড তৈরি/পাঠানো হয় না; উত্তর একই', async () => {
    const dest = 'otp-dest@test.local';
    const bodies = [];
    for (let i = 0; i < 7; i++) bodies.push(await otpSend(dest, `198.51.100.${80 + i}`));
    expect(bodies[0].status).toBe(200);
    for (const b of bodies) expect(b).toEqual(bodies[0]);
    expect(sent.otp.filter((d) => d === dest)).toHaveLength(5);
    expect(await db.otp.count({ where: { destination: dest } })).toBe(5);
  });

  it('অন্য গন্তব্য আটকায় না', async () => {
    for (let i = 0; i < 6; i++) await otpSend('flood@test.local', `198.51.100.${100 + i}`);
    sent.otp.length = 0;
    expect((await otpSend('other@test.local', '198.51.100.120')).status).toBe(200);
    expect(sent.otp).toEqual(['other@test.local']);
  });
});
