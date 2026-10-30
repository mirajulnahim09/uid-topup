/**
 * ═══════════════════════════════════════════════════════════
 * ★★★ অডিট-লগ: রেজিস্ট্রেশন ও লগইন-অবস্থায় পাসওয়ার্ড বদল
 *     (চূড়ান্ত মাস্টার অডিট, ২০২৬-০৯-১৭)
 *
 *   আগে `REGISTER` অ্যাকশন সংজ্ঞায়িত থাকলেও কখনো লেখা হতো না, আর
 *   `/api/account/password` কেবল বিজ্ঞপ্তি দিত — লগ নয়। দাবি:
 *     · সফল রেজিস্ট্রেশন → REGISTER (গ্রাহক, নিজের id, IP/UA)
 *     · সফল পাসওয়ার্ড বদল → PASSWORD_CHANGE; ভুল বর্তমান পাসওয়ার্ডে লগ নয়
 *     · পাসওয়ার্ড কখনো লগে নয়
 * ═══════════════════════════════════════════════════════════
 */
import { describe, it, expect } from 'vitest';
import { db } from '../vitest.setup';
import { client, signedInUser } from './helpers/app';
import { DEFAULT_PASSWORD } from './helpers/factories';
import { issueOtp } from '../src/lib/otp/core';

/** লগ best-effort (await করা হয় না) — একটু অপেক্ষা করে খোঁজা */
async function findLog(action: string, targetId: string) {
  for (let i = 0; i < 30; i++) {
    const row = await db.adminLog.findFirst({ where: { action, targetId } });
    if (row) return row;
    await new Promise((r) => setTimeout(r, 100));
  }
  return null;
}

describe('অডিট — রেজিস্ট্রেশন', () => {
  it('সফল রেজিস্ট্রেশনে REGISTER লগ, পাসওয়ার্ড ছাড়া', async () => {
    const tag = Math.random().toString(36).slice(2, 8);
    const email = `audit-${tag}@test.local`;
    const password = 'AuditReg2026x';
    const { code } = await issueOtp({ channel: 'EMAIL', purpose: 'REGISTER', destination: email, ip: '127.0.0.1' });
    const res = await client().post('/api/register', {
      name: 'Audit Tester', email, phone: `013${Math.floor(10_000_000 + Math.random() * 89_999_999)}`, password, code,
    });
    expect(res.status).toBe(200);
    const user = await db.user.findUniqueOrThrow({ where: { email } });
    const log = await findLog('REGISTER', user.id);
    expect(log).not.toBeNull();
    expect(log!.actorType).toBe('CUSTOMER');
    expect(log!.adminId).toBe(user.id);
    expect(JSON.stringify(log)).not.toContain(password);
  });

  it('ব্যর্থ রেজিস্ট্রেশনে (ভুল কোড) কোনো REGISTER লগ নয়', async () => {
    const before = await db.adminLog.count({ where: { action: 'REGISTER' } });
    const email = `audit-bad-${Math.random().toString(36).slice(2, 8)}@test.local`;
    await issueOtp({ channel: 'EMAIL', purpose: 'REGISTER', destination: email, ip: '127.0.0.1' });
    const res = await client().post('/api/register', {
      name: 'Audit Tester', email, phone: `013${Math.floor(10_000_000 + Math.random() * 89_999_999)}`, password: 'AuditReg2026x', code: '000000',
    });
    expect(res.status).toBe(400);
    await new Promise((r) => setTimeout(r, 500));
    expect(await db.adminLog.count({ where: { action: 'REGISTER' } })).toBe(before);
  });
});

describe('অডিট — পাসওয়ার্ড বদল', () => {
  it('সফল বদলে PASSWORD_CHANGE লগ; পাসওয়ার্ড লগে নেই', async () => {
    const { user, client: c } = await signedInUser(db, {});
    const next = 'AuditChange2026x';
    const res = await c.post('/api/account/password', { current: DEFAULT_PASSWORD, next });
    expect(res.status).toBe(200);
    const log = await findLog('PASSWORD_CHANGE', user.id);
    expect(log).not.toBeNull();
    expect(log!.adminId).toBe(user.id);
    expect(JSON.stringify(log)).not.toContain(next);
    expect(JSON.stringify(log)).not.toContain(DEFAULT_PASSWORD);
  });

  it('ভুল বর্তমান পাসওয়ার্ডে লগ নয়', async () => {
    const { user, client: c } = await signedInUser(db, {});
    const res = await c.post('/api/account/password', { current: 'WrongPass2026x', next: 'AuditChange2026x' });
    expect(res.status).toBe(400);
    await new Promise((r) => setTimeout(r, 500));
    expect(await db.adminLog.count({ where: { action: 'PASSWORD_CHANGE', targetId: user.id } })).toBe(0);
  });
});
