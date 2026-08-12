/**
 * ═══════════════════════════════════════════════════════════
 * ★★★ Group I (৩) — OTP অ্যাডমিন কনফিগ
 *
 *   দুটি প্রশ্ন: **কে বদলাতে পারে**, আর **কী ফাঁস হয়**।
 *   ক্রেডেনশিয়াল at rest এনক্রিপ্টেড থাকে ও উত্তরে কখনো যায় না —
 *   Group E এর গেটওয়ে-কনফিগে যে নিয়ম, হুবহু সেটিই।
 * ═══════════════════════════════════════════════════════════
 */
import { describe, it, expect } from 'vitest';
import { db } from '../vitest.setup';
import { client, signedInAdmin, signedInUser } from './helpers/app';
import { OTP_KEYS } from '../src/lib/otp/settings';

describe('OTP অ্যাডমিন — কে বদলাতে পারে', () => {
  it('লগইন ছাড়া পড়া যায় না', async () => {
    expect((await client().get('/api/admin/otp')).status).toBe(401);
  });

  it('সাধারণ ইউজার বদলাতে পারে না (403)', async () => {
    const { client: c } = await signedInUser(db, {});
    expect((await c.get('/api/admin/otp')).status).toBe(403);
    expect((await c.post('/api/admin/otp', { emailEnabled: false })).status).toBe(403);
  });

  it('অ্যাডমিন পড়তে ও বদলাতে পারেন', async () => {
    const { client: c } = await signedInAdmin(db);

    const read = await c.get('/api/admin/otp');
    expect(read.status).toBe(200);
    // ★ ডিফল্ট — সাইনআপে বাধ্যতামূলক চালু, SMS বন্ধ
    expect(read.body.config.requireAtSignup).toBe(true);
    expect(read.body.config.smsEnabled).toBe(false);

    const res = await c.post('/api/admin/otp', { requireAtDeposit: true });
    expect(res.status).toBe(200);
    expect(res.body.config.requireAtDeposit).toBe(true);
  });

  it('অজানা চ্যানেল প্রত্যাখ্যাত', async () => {
    const { client: c } = await signedInAdmin(db);
    expect((await c.post('/api/admin/otp', { signupChannel: 'pigeon' })).status).toBe(400);
  });

  it('অজানা SMS প্রোভাইডার প্রত্যাখ্যাত', async () => {
    const { client: c } = await signedInAdmin(db);
    expect((await c.post('/api/admin/otp', { smsProvider: 'nope' })).status).toBe(400);
  });
});

describe('OTP অ্যাডমিন — ক্রেডেনশিয়াল', () => {
  /** ★★★ এই স্যুটের সবচেয়ে গুরুত্বপূর্ণ টেস্ট */
  it('ক্রেডেনশিয়াল এনক্রিপ্টেড থাকে ও উত্তরে ফেরে না', async () => {
    const { client: c } = await signedInAdmin(db);
    const SECRET = 'sk-live-8k3jf9-DO-NOT-LEAK';

    const res = await c.post('/api/admin/otp', {
      smsProvider: 'sslwireless',
      credentials: { apiToken: SECRET, sid: 'MYSID' },
    });
    expect(res.status).toBe(200);

    // ★ উত্তরে কোথাও মানটি নেই
    expect(JSON.stringify(res.body)).not.toContain(SECRET);
    // ★ কেবল "সেট আছে" জানানো হয়
    const set = res.body.channels.sms.keysSet.find((k: { key: string }) => k.key === 'apiToken');
    expect(set?.set).toBe(true);

    // ★ DB-তেও প্লেইনটেক্সট নেই
    const row = await db.setting.findUnique({ where: { key: OTP_KEYS.smsCredentials } });
    expect(row?.value).toBeTruthy();
    expect(row!.value).not.toContain(SECRET);
  });

  it('masked মান পাঠালে আগেরটি অপরিবর্তিত থাকে', async () => {
    const { client: c } = await signedInAdmin(db);
    const SECRET = 'original-token-value';

    await c.post('/api/admin/otp', {
      smsProvider: 'sslwireless',
      credentials: { apiToken: SECRET },
    });
    const before = (await db.setting.findUnique({ where: { key: OTP_KEYS.smsCredentials } }))!.value;

    // ★ UI যা পাঠাত যদি অ্যাডমিন ঘরটি না ছুঁতেন
    await c.post('/api/admin/otp', { credentials: { apiToken: '••••••' } });
    const after = (await db.setting.findUnique({ where: { key: OTP_KEYS.smsCredentials } }))!.value;

    expect(after).toBe(before);
  });

  it('অ্যাডমিন লগে মান যায় না, কেবল কোন ফিল্ড বদলাল', async () => {
    const { client: c } = await signedInAdmin(db);
    const SECRET = 'another-secret-42';

    await c.post('/api/admin/otp', {
      smsProvider: 'alphasms',
      credentials: { apiKey: SECRET },
    });

    const logs = await db.adminLog.findMany({ orderBy: { createdAt: 'desc' }, take: 5 });
    const blob = JSON.stringify(logs);
    expect(blob).not.toContain(SECRET);
    expect(blob).toContain('OTP:');
  });
});

describe('OTP অ্যাডমিন — সংযোগ পরীক্ষা', () => {
  it('SMS বন্ধ থাকলে পরীক্ষা করা যায় না', async () => {
    const { client: c } = await signedInAdmin(db);
    const res = await c.put('/api/admin/otp', { to: '01712345678' });
    expect(res.status).toBe(400);
  });

  it('অবৈধ নাম্বার প্রত্যাখ্যাত', async () => {
    const { client: c } = await signedInAdmin(db);
    expect((await c.put('/api/admin/otp', { to: '123' })).status).toBe(400);
  });

  it('log প্রোভাইডারে পরীক্ষা সফল হয় (কোথাও পাঠায় না)', async () => {
    const { client: c } = await signedInAdmin(db);
    await c.post('/api/admin/otp', { smsProvider: 'log', smsEnabled: true });

    const res = await c.put('/api/admin/otp', { to: '01712345678' });
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('SENT');
  });

  it('বাস্তবায়িত নয় এমন গেটওয়ে স্পষ্টভাবে ব্যর্থ হয়, নীরবে নয়', async () => {
    const { client: c } = await signedInAdmin(db);
    await c.post('/api/admin/otp', { smsProvider: 'sslwireless', smsEnabled: true });

    const res = await c.put('/api/admin/otp', { to: '01712345678' });
    expect(res.status).toBe(200);
    // ★ "SENT" বলা যাবে না — কিছুই পাঠানো হয়নি
    expect(res.body.status).toBe('FAILED');
    expect(res.body.reason).toMatch(/বাস্তবায়িত হয়নি/);
  });
});
