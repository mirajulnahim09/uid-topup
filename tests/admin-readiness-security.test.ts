/**
 * ═══════════════════════════════════════════════════════════
 * ★★★ Release-readiness — অ্যাডমিন-অ্যাকাউন্টের নিরাপত্তা
 *
 *   লাইভ অ্যাডমিন রিপোতে-লেখা seed-পাসওয়ার্ডে থেকে গেলে বা 2FA বন্ধ থাকলে
 *   readiness আগে কিছুই বলত না। দাবি (আসল HTTP):
 *     · ডিফল্ট পাসওয়ার্ডের অ্যাডমিন → ব্লকার (ইমেইল মুখোশে; পাসওয়ার্ড/হ্যাশ কখনো নয়)
 *     · পাসওয়ার্ড বদলালে ব্লকার চলে যায়
 *     · 2FA বন্ধ → ব্লকার: the harness runs a production build (outside
 *       production the same message is only a warning — a code branch)
 * ═══════════════════════════════════════════════════════════
 */
import { describe, it, expect } from 'vitest';
import bcrypt from 'bcryptjs';
import { db } from '../vitest.setup';
import { signedInAdmin } from './helpers/app';
import { DEFAULT_SEED_ADMIN_PASSWORD } from '../src/lib/seedDefaults';

type Ready = { blockers: string[]; warnings: string[] };

describe('readiness — অ্যাডমিন নিরাপত্তা', () => {
  it('ডিফল্ট-পাসওয়ার্ডের অ্যাডমিন → ব্লকার; বদলালে চলে যায়; কোনো গোপন মান ফাঁস নয়', async () => {
    const { client } = await signedInAdmin(db);
    const risky = await db.user.create({
      data: {
        email: 'legacy-admin@example.test', name: 'Legacy', phone: '01800000077', role: 'ADMIN',
        password: await bcrypt.hash(DEFAULT_SEED_ADMIN_PASSWORD, 10), referralCode: 'LEGACYADM',
      },
    });
    const r1 = await client.get<Ready>('/api/admin/readiness');
    const hit = r1.body.blockers.filter((b) => b.includes('ডিফল্ট পাসওয়ার্ড'));
    expect(hit).toHaveLength(1);
    expect(hit[0]).toContain('l***@example.test');
    const raw = JSON.stringify(r1.body);
    expect(raw).not.toContain(DEFAULT_SEED_ADMIN_PASSWORD);
    expect(raw).not.toContain(risky.password);

    await db.user.update({ where: { id: risky.id }, data: { password: await bcrypt.hash('Changed-Strong-2026!', 10) } });
    const r2 = await client.get<Ready>('/api/admin/readiness');
    expect(r2.body.blockers.some((b) => b.includes('ডিফল্ট পাসওয়ার্ড'))).toBe(false);
  });

  it('2FA-বিহীন অ্যাডমিন → (প্রোডাকশন বিল্ডে) ব্লকার; 2FA চালু হলে নয়', async () => {
    const { admin, client } = await signedInAdmin(db);
    const r1 = await client.get<Ready>('/api/admin/readiness');
    expect(r1.body.blockers.some((b) => b.includes('2FA বন্ধ'))).toBe(true);
    expect(r1.body.warnings.some((w) => w.includes('2FA বন্ধ'))).toBe(false);
    await db.user.update({ where: { id: admin.id }, data: { twoFactorEnabled: true, twoFactorSecret: 'x' } });
    const r2 = await client.get<Ready>('/api/admin/readiness');
    expect(r2.body.blockers.some((b) => b.includes('2FA বন্ধ'))).toBe(false);
    expect(r2.body.warnings.some((w) => w.includes('2FA বন্ধ'))).toBe(false);
  });
});
