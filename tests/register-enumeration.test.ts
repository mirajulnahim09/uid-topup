/**
 * ═══════════════════════════════════════════════════════════
 * ★★★ AUTH-02 — রেজিস্ট্রেশন দিয়ে অ্যাকাউন্ট-গণনা (enumeration) বন্ধ
 *
 *   আগে কোড ছাড়াই `/api/register` বলে দিত "এই ইমেইল/মোবাইল দিয়ে অ্যাকাউন্ট
 *   আছে" (৪০৯)। আর বার্তা আলাদা ছিল: নিবন্ধিত ইমেইলে কারণ সবসময় "কোনো কোড
 *   পাঠানো হয়নি", অনিবন্ধিতে কোড চেয়ে ভুল দিলে "কোডটি মিলছে না"। দাবি:
 *     · কোড ছাড়া/ভুল কোডে নিবন্ধিত ও অনিবন্ধিত ইমেইল/ফোনের উত্তর হুবহু এক
 *     · বৈধ কোড (= ইমেইলের মালিক) থাকলে ডুপ্লিকেট-বার্তা আগের মতোই (৪০৯)
 * ═══════════════════════════════════════════════════════════
 */
import { describe, it, expect } from 'vitest';
import { db } from '../vitest.setup';
import { client } from './helpers/app';
import { createUser } from './helpers/factories';
import { issueOtp } from '../src/lib/otp/core';

let seq = 0;
function form(over: Record<string, unknown> = {}) {
  const tag = `${Date.now().toString(36)}${seq++}`;
  return {
    name: 'গণনা পরীক্ষা',
    email: `enum-${tag}@test.local`,
    phone: `015${String(10_000_000 + seq * 7919).slice(0, 8)}`,
    password: 'Test1234',
    ...over,
  };
}
const codeFor = async (email: string) =>
  (await issueOtp({ channel: 'EMAIL', purpose: 'REGISTER', destination: email, ip: '127.0.0.1' })).code;
const reg = async (body: Record<string, unknown>) => {
  const r = await client().post<{ error?: string }>('/api/register', body);
  return { status: r.status, error: r.body?.error };
};

describe('AUTH-02 — নিবন্ধিত বনাম অনিবন্ধিত: একই উত্তর', () => {
  it('কোড ছাড়া: নিবন্ধিত ইমেইল, নিবন্ধিত ফোন ও নতুন — তিনটিই হুবহু এক', async () => {
    const existing = await createUser(db);
    const a = await reg(form({ email: existing.email, code: '123456' }));
    const b = await reg(form({ phone: existing.phone, code: '123456' }));
    const c = await reg(form({ code: '123456' }));
    expect(a).toEqual(c);
    expect(b).toEqual(c);
    expect(c.status).toBe(400);
    expect(String(c.error)).not.toContain('অ্যাকাউন্ট আছে');
  });

  it('আক্রমণ-ক্রম: নতুন ইমেইলে কোড চেয়ে ভুল দেওয়া বনাম নিবন্ধিত ইমেইলে ভুল দেওয়া — একই', async () => {
    const existing = await createUser(db);
    const fresh = form();
    await codeFor(fresh.email); // otp/send-এর মতোই: কেবল অনিবন্ধিত ইমেইলে কোড তৈরি হয়
    const onFresh = await reg({ ...fresh, code: '000000' });
    const onExisting = await reg(form({ email: existing.email, code: '000000' }));
    expect(onExisting).toEqual(onFresh);
  });

  it('বৈধ কোড থাকলে (ইমেইলের মালিক) ডুপ্লিকেট ফোন-বার্তা আগের মতোই ৪০৯', async () => {
    const existing = await createUser(db);
    const f = form({ phone: existing.phone });
    const r = await reg({ ...f, code: await codeFor(f.email) });
    expect(r.status).toBe(409);
    expect(String(r.error)).toContain('মোবাইল');
    // কোড খরচ হয়নি (ট্রানজেকশন ফিরে গেছে) — ফোন ঠিক করে আবার চেষ্টা করা যায়
    expect(await db.otp.count({ where: { destination: f.email, consumedAt: null } })).toBe(1);
  });

  it('সঠিক কোডে নতুন অ্যাকাউন্ট আগের মতোই তৈরি হয়', async () => {
    const f = form();
    const r = await reg({ ...f, code: await codeFor(f.email) });
    expect(r.status).toBe(200);
    expect(await db.user.count({ where: { email: f.email } })).toBe(1);
  });
});
