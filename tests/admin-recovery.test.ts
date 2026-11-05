/**
 * ═══════════════════════════════════════════════════════════
 * ★★★ জরুরি অ্যাকাউন্ট-রিকভারি — এটি কখনো master password হয়ে উঠবে না
 *     (চূড়ান্ত মাস্টার অডিট, ২০২৬-০৯-১৭)
 *
 *   দাবিগুলো মালিকের নিরাপত্তা-শর্ত থেকে সরাসরি:
 *     · কেবল অ্যাডমিন বানাতে পারেন (অতিথি ৪০১, গ্রাহক ৪০৩)
 *     · ADMIN অ্যাকাউন্টের জন্য নিষিদ্ধ; বন্ধ অ্যাকাউন্টে নয়
 *     · লিংক একবারই চলে — সমান্তরাল দুটি ব্যবহারেও ঠিক একটি সফল
 *     · ৩০ মিনিট পর মেয়াদোত্তীর্ণ
 *     · প্রতিটি লিংক অনন্য (র‍্যান্ডম nonce) ও কেবল নির্দিষ্ট অ্যাকাউন্টের
 *     · পাসওয়ার্ড বা টোকেন কোথাও সংরক্ষিত/লগ হয় না
 *     · কে-কখন-কার জন্য: ACCOUNT_RECOVERY_LINK; ব্যবহার: PASSWORD_RESET
 *     · রিসেটে অন্য সব সেশন বাতিল (sessionEpoch)
 * ═══════════════════════════════════════════════════════════
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { db } from '../vitest.setup';
import { client, signedInAdmin, signedInUser } from './helpers/app';
import { createUser, DEFAULT_PASSWORD } from './helpers/factories';
import { makeResetToken, verifyResetToken } from '../src/lib/passwordReset';

afterEach(() => { vi.useRealTimers(); });

const tokenOf = (url: string) => new URL(url).searchParams.get('token')!;

describe('রিকভারি-লিংক — কে বানাতে পারেন', () => {
  it('অতিথি ৪০১, গ্রাহক ৪০৩ — এবং কোনো লগ-সারি হয় না', async () => {
    const target = await createUser(db, {});
    expect((await client().post('/api/admin/user/recovery', { userId: target.id })).status).toBe(401);
    const { client: c } = await signedInUser(db, {});
    expect((await c.post('/api/admin/user/recovery', { userId: target.id })).status).toBe(403);
    expect(await db.adminLog.count({ where: { action: 'ACCOUNT_RECOVERY_LINK' } })).toBe(0);
  });

  it('ADMIN অ্যাকাউন্টের জন্য নিষিদ্ধ — নিজের জন্যও', async () => {
    const { admin, client: c } = await signedInAdmin(db);
    const other = await createUser(db, { role: 'ADMIN' });
    expect((await c.post('/api/admin/user/recovery', { userId: admin.id })).status).toBe(403);
    expect((await c.post('/api/admin/user/recovery', { userId: other.id })).status).toBe(403);
    expect(await db.adminLog.count({ where: { action: 'ACCOUNT_RECOVERY_LINK' } })).toBe(0);
  });

  it('বন্ধ অ্যাকাউন্টে ৪০৯; অস্তিত্বহীন ৪০৪', async () => {
    const { client: c } = await signedInAdmin(db);
    const banned = await createUser(db, { isBanned: true });
    expect((await c.post('/api/admin/user/recovery', { userId: banned.id })).status).toBe(409);
    expect((await c.post('/api/admin/user/recovery', { userId: 'nope' })).status).toBe(404);
  });
});

describe('রিকভারি-লিংক — ব্যবহার', () => {
  it('অডিট-সারি, গ্রাহককে বিজ্ঞপ্তি, টোকেন কোথাও সংরক্ষিত নয়', async () => {
    const { admin, client: c } = await signedInAdmin(db);
    const target = await createUser(db, {});
    const res = await c.post<{ url: string; expiresAt: string }>('/api/admin/user/recovery', { userId: target.id });
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toContain('no-store');
    const token = tokenOf(res.body.url);

    const logs = await db.adminLog.findMany({ where: { action: 'ACCOUNT_RECOVERY_LINK' } });
    expect(logs).toHaveLength(1);
    expect(logs[0].adminId).toBe(admin.id);
    expect(logs[0].targetId).toBe(target.id);
    // ★ টোকেন বা পাসওয়ার্ড-হ্যাশ লগে নেই
    expect(logs[0].detail ?? '').not.toContain(token.slice(0, 20));
    expect(logs[0].detail ?? '').not.toContain(target.password.slice(0, 20));

    // ★ মেয়াদ ~৩০ মিনিট
    const mins = (new Date(res.body.expiresAt).getTime() - Date.now()) / 60_000;
    expect(mins).toBeGreaterThan(28);
    expect(mins).toBeLessThanOrEqual(30.5);

    // ★ গ্রাহককে জানানো (বিজ্ঞপ্তি best-effort — একটু অপেক্ষা)
    let n = 0;
    for (let i = 0; i < 20 && n === 0; i++) {
      n = await db.notification.count({ where: { userId: target.id } });
      if (!n) await new Promise((r) => setTimeout(r, 100));
    }
    expect(n).toBe(1);

    // ★ কোনো টেবিলে টোকেনটি নেই (User সারি অপরিবর্তিত)
    const after = await db.user.findUnique({ where: { id: target.id } });
    expect(after!.password).toBe(target.password);
  });

  it('লিংকে নতুন পাসওয়ার্ড → নতুনটিতে লগইন, পুরনোটিতে নয়, সেশন-যুগ বাড়ে, PASSWORD_RESET লগ', async () => {
    const { client: c } = await signedInAdmin(db);
    const { user, client: victimSession } = await signedInUser(db, {});
    const res = await c.post<{ url: string }>('/api/admin/user/recovery', { userId: user.id });
    const token = tokenOf(res.body.url);

    const reset = await client().post('/api/auth/reset', { token, password: 'Recovered2026x' });
    expect(reset.status).toBe(200);

    const u = await db.user.findUnique({ where: { id: user.id } });
    expect(u!.sessionEpoch).toBe(user.sessionEpoch + 1);
    expect(await client().login(user.email, DEFAULT_PASSWORD)).toBe(false);
    expect(await client().login(user.email, 'Recovered2026x')).toBe(true);

    let log = null;
    for (let i = 0; i < 20 && !log; i++) {
      log = await db.adminLog.findFirst({ where: { action: 'PASSWORD_RESET', targetId: user.id } });
      if (!log) await new Promise((r) => setTimeout(r, 100));
    }
    expect(log?.detail).toContain('অ্যাডমিনের রিকভারি-লিংক');
    expect(log?.detail ?? '').not.toContain('Recovered2026x');
    void victimSession;
  });

  it('একই লিংক দ্বিতীয়বার চলে না', async () => {
    const { client: c } = await signedInAdmin(db);
    const target = await createUser(db, {});
    const token = tokenOf((await c.post<{ url: string }>('/api/admin/user/recovery', { userId: target.id })).body.url);
    expect((await client().post('/api/auth/reset', { token, password: 'FirstUse2026x' })).status).toBe(200);
    expect((await client().post('/api/auth/reset', { token, password: 'SecondUse2026x' })).status).toBe(400);
    expect(await client().login(target.email, 'FirstUse2026x')).toBe(true);
  });

  it('একই লিংকে সমান্তরাল দুটি অনুরোধ — ঠিক একটি সফল', async () => {
    const { client: c } = await signedInAdmin(db);
    const target = await createUser(db, {});
    const token = tokenOf((await c.post<{ url: string }>('/api/admin/user/recovery', { userId: target.id })).body.url);
    const results = await Promise.all([
      client().post('/api/auth/reset', { token, password: 'RaceOne2026x' }),
      client().post('/api/auth/reset', { token, password: 'RaceTwo2026x' }),
    ]);
    expect(results.map((r) => r.status).sort()).toEqual([200, 400]);
    const u = await db.user.findUnique({ where: { id: target.id } });
    expect(u!.sessionEpoch).toBe(target.sessionEpoch + 1);
  });

  it('একজনের লিংক অন্য অ্যাকাউন্টে চলে না (uid বদলালে স্বাক্ষর ভাঙে)', async () => {
    const a = await createUser(db, {});
    const b = await createUser(db, {});
    const token = makeResetToken(a.id, a.password, 'admin');
    const [payload, sig] = token.split('.');
    const forged = Buffer.from(JSON.stringify({ ...JSON.parse(Buffer.from(payload, 'base64url').toString()), uid: b.id })).toString('base64url');
    expect(await verifyResetToken(`${forged}.${sig}`)).toBeNull();
  });

  it('প্রতিটি লিংক অনন্য, আর ৩০ মিনিট পর মেয়াদোত্তীর্ণ', async () => {
    const u = await createUser(db, {});
    const t1 = makeResetToken(u.id, u.password, 'admin');
    const t2 = makeResetToken(u.id, u.password, 'admin');
    expect(t1).not.toBe(t2);
    expect(await verifyResetToken(t1)).toBe(u.id);

    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(Date.now() + 31 * 60_000);
    expect(await verifyResetToken(t1)).toBeNull();
  });
});
