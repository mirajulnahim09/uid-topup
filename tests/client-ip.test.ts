/**
 * ═══════════════════════════════════════════════════════════
 * ★★★ CFG-01 — ক্লায়েন্ট-IP না পাওয়া আর নীরব নয়
 *
 *   কোনো বিশ্বস্ত হেডার না থাকলে `pickIp()` `'unknown'` দেয় আর সব দর্শনার্থী
 *   একটিই IP-বাকেট ভাগ করেন (সারা সাইটের লগইন/রেজিস্ট্রেশন আটকানোর ঝুঁকি)।
 *   সীমা অপরিবর্তিত; দাবি কেবল: ঘটনাটি গোনা হয় এবং readiness-এ দেখা যায়।
 * ═══════════════════════════════════════════════════════════
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { db } from '../vitest.setup';
import { pickIp, clientIpStatus } from '../src/lib/rateLimit';
import { signedInAdmin } from './helpers/app';

afterEach(() => vi.unstubAllEnvs());

const headers = (h: Record<string, string>) => (n: string) => h[n];

describe('CFG-01 — pickIp', () => {
  it('প্ল্যাটফর্ম-হেডার থাকলে IP দেয়, কিছু গোনে না', () => {
    const before = clientIpStatus().missingCount;
    expect(pickIp(headers({ 'x-real-ip': '203.0.113.7' }))).toBe('203.0.113.7');
    expect(pickIp(headers({ 'cf-connecting-ip': '203.0.113.8' }))).toBe('203.0.113.8');
    expect(clientIpStatus().missingCount).toBe(before);
  });

  it('হেডার না থাকলে "unknown" — এবং ঘটনাটি গোনা হয়', () => {
    const before = clientIpStatus().missingCount;
    expect(pickIp(headers({}))).toBe('unknown');
    const after = clientIpStatus();
    expect(after.missingCount).toBe(before + 1);
    expect(after.lastMissingAt).not.toBeNull();
  });

  it('TRUSTED_PROXY ছাড়া x-forwarded-for উপেক্ষিত (H2 অক্ষত) ও গোনা হয়', () => {
    vi.stubEnv('TRUSTED_PROXY', '');
    const before = clientIpStatus().missingCount;
    expect(pickIp(headers({ 'x-forwarded-for': '1.2.3.4' }))).toBe('unknown');
    expect(clientIpStatus().missingCount).toBe(before + 1);
  });

  it('TRUSTED_PROXY থাকলে x-forwarded-for-এর বাঁ-দিকের মান, কিছু গোনে না', () => {
    vi.stubEnv('TRUSTED_PROXY', '1');
    const before = clientIpStatus().missingCount;
    expect(pickIp(headers({ 'x-forwarded-for': '1.2.3.4, 10.0.0.1' }))).toBe('1.2.3.4');
    expect(clientIpStatus().missingCount).toBe(before);
  });
});

describe('CFG-01 — চলমান সার্ভারের readiness', () => {
  it('হেডারহীন অনুরোধের পরে readiness সতর্কতা দেখায় (অন্য রুটে ঘটলেও)', async () => {
    // টেস্ট-হারনেস কোনো IP হেডার পাঠায় না — লগইনের অনুরোধেই (NextAuth রুট) ঘটনাটি ঘটে,
    // আর readiness একটি **আলাদা** রুট: DB-চিহ্ন না থাকলে সে এটি দেখতেই পেত না
    const { client: adm } = await signedInAdmin(db);
    // ★ চিহ্ন-লেখা অনুরোধকে আটকায় না (fire-and-forget) — তাই অনুমান নয়, অপেক্ষা
    await vi.waitFor(async () => {
      expect(await db.setting.findUnique({ where: { key: 'ops:client_ip_missing' } })).not.toBeNull();
    }, { timeout: 5000, interval: 100 });
    const r = await adm.get<{ warnings: string[]; clientIp: { lastMissingAt: string | null } }>(
      '/api/admin/readiness',
    );
    expect(r.status).toBe(200);
    expect(r.body.clientIp.lastMissingAt).not.toBeNull();
    expect(r.body.warnings.some((w) => w.includes('ক্লায়েন্ট-IP হেডার পাওয়া যাচ্ছে না'))).toBe(true);
  });

  it('IP-সীমাগুলো অপরিবর্তিত — কেবল দৃশ্যমান, আচরণ নয় (নিয়ন্ত্রণ)', async () => {
    expect(await db.setting.findUnique({ where: { key: 'ops:client_ip_missing' } })).toBeNull();
    const { client: adm } = await signedInAdmin(db); // হেডারহীন লগইন এখনো সফল
    expect((await adm.get('/api/me')).status).toBe(200);
    await vi.waitFor(async () => {
      expect(await db.setting.findUnique({ where: { key: 'ops:client_ip_missing' } })).not.toBeNull();
    }, { timeout: 5000, interval: 100 });
  });
});
