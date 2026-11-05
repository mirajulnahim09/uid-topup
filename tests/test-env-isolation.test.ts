/**
 * ═══════════════════════════════════════════════════════════
 * ★★★ টেস্টের গোপন-মান বিচ্ছিন্নতা — রিগ্রেশন (বিস্তারিত: helpers/testEnv.ts)
 *
 *   মাপা সমস্যা: `@prisma/client` import-এ Prisma প্রকল্পের `.env` পড়ে লাইভ কী
 *   টেস্ট-প্রসেসে বসাত; CFG-01-এর ইউনিট টেস্ট তখন লাইভ বট দিয়ে টেলিগ্রামে POST
 *   করার চেষ্টা করত। এখানকার দাবি — সবই চালিয়ে দেখা, কোনো মান ছাপা হয় না:
 *     ১. টেস্ট-প্রসেস ও টেস্ট-সার্ভার দুজনেই টেস্ট-কেবল NEXTAUTH_SECRET ব্যবহার করে
 *     ২. DATABASE_URL টেস্ট DB; অ্যাপের নিজের prisma ক্লায়েন্টও টেস্ট DB-তে
 *     ৩. টেলিগ্রাম/ইমেইল/ব্লব/গুগল কী কোথাও নেই; আগের লিক-পথ আর বাইরে যায় না
 * ═══════════════════════════════════════════════════════════
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { decode } from 'next-auth/jwt';
import { db } from '../vitest.setup';
import { signedInAdmin, signedInUser } from './helpers/app';
import { SESSION_COOKIE } from './helpers/http';
import {
  TEST_DATABASE_URL, TEST_NEXTAUTH_SECRET, TEST_CRON_SECRET, TEST_ISOLATED_ENV, assertSafeTestUrl,
} from './helpers/testEnv';

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe('১. NEXTAUTH_SECRET — কেবল টেস্ট-মান', () => {
  it('টেস্ট-প্রসেসে টেস্ট-কেবল secret', () => {
    expect(process.env.NEXTAUTH_SECRET === TEST_NEXTAUTH_SECRET).toBe(true);
  });

  it('টেস্ট-সার্ভার সেশন টেস্ট-কেবল secret দিয়ে সই করে (অন্য secret-এ খোলে না)', async () => {
    const { user, client } = await signedInUser(db);
    const r = await client.raw('/api/auth/session');
    // ★ jar থেকে সেশন কুকি — Set-Cookie হেডারে নয়, তাই সরাসরি লগইন-পরের অবস্থা পড়ি
    const token = (client as unknown as { jar: Map<string, string> }).jar.get(SESSION_COOKIE);
    expect(r.status).toBe(200);
    expect(token).toBeTruthy();
    const ok = await decode({ token: token!, secret: TEST_NEXTAUTH_SECRET });
    expect(ok?.email).toBe(user.email);
    const other = await decode({ token: token!, secret: 'some-other-secret-0000000000000000000' }).catch(() => null);
    expect(other).toBeNull();
  });
});

describe('২. DATABASE_URL — কেবল টেস্ট DB', () => {
  it('টেস্ট-প্রসেসের DATABASE_URL টেস্ট URL', () => {
    expect(process.env.DATABASE_URL === TEST_DATABASE_URL).toBe(true);
    expect(() => assertSafeTestUrl(TEST_DATABASE_URL)).not.toThrow();
  });

  it('অ্যাপের নিজের prisma ক্লায়েন্ট (src/lib/prisma) টেস্ট DB-তে সংযুক্ত', async () => {
    const { prisma } = await import('../src/lib/prisma');
    const rows = await prisma.$queryRaw<Array<{ db: string }>>`SELECT current_database() AS db`;
    expect(rows[0].db).toBe('uidtopup_test');
  });

  it('রিমোট বা `_test`-বিহীন URL গার্ডে আটকায়', () => {
    expect(() => assertSafeTestUrl('postgresql://u:p@ep-example.neon.tech/uidtopup_test')).toThrow();
    expect(() => assertSafeTestUrl('postgresql://u:p@localhost:5432/uidtopup')).toThrow();
  });
});

describe('৩. লাইভ ইন্টিগ্রেশন কী অনুপলব্ধ', () => {
  it('টেস্ট-প্রসেসে প্রতিটি গোপন/ইন্টিগ্রেশন কী ঠিক টেস্ট-মানে', () => {
    const wrong = Object.entries(TEST_ISOLATED_ENV).filter(([k, v]) => process.env[k] !== v).map(([k]) => k);
    expect(wrong).toEqual([]);
    for (const k of ['TELEGRAM_BOT_TOKEN', 'TELEGRAM_CHAT_ID', 'RESEND_API_KEY', 'BLOB_READ_WRITE_TOKEN']) {
      expect(process.env[k] ?? '').toBe('');
    }
    // ★ CRON_SECRET খালি নয়, কিন্তু কেবল টেস্ট-মান (SEC-05-এর Bearer-পথ পরীক্ষার জন্য)
    expect(process.env.CRON_SECRET === TEST_CRON_SECRET).toBe(true);
  });

  it('আগের লিক-পথ: হেডারহীন pickIp() আর টেলিগ্রামে যায় না (নিয়ন্ত্রণসহ)', async () => {
    vi.stubEnv('CLIENT_IP_WARN_THROTTLE_MS', '0');
    const calls: string[] = [];
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      const u = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url);
      calls.push(u.host);
      return new Response(JSON.stringify({ ok: true, result: {} }), { status: 200 });
    });
    const { pickIp } = await import('../src/lib/rateLimit');

    pickIp(() => undefined);
    await new Promise((r) => setTimeout(r, 2500));
    expect(calls.filter((h) => h === 'api.telegram.org')).toEqual([]);

    // ★ নিয়ন্ত্রণ: কী থাকলে একই পথ সত্যিই টেলিগ্রামে যেত — তাই উপরের "০" অর্থবহ।
    //   fetch mock করা, তাই এখানেও কিছু বাইরে যায় না।
    vi.stubEnv('TELEGRAM_BOT_TOKEN', '123456:fake-token-for-control-only');
    vi.stubEnv('TELEGRAM_CHAT_ID', '1');
    pickIp(() => undefined);
    await vi.waitFor(() => expect(calls).toContain('api.telegram.org'), { timeout: 5000, interval: 100 });
  });

  it('টেস্ট-সার্ভারেও কী নেই: readiness-এ ইমেইল/ব্লব/গুগল অনুপস্থিত, টেলিগ্রাম কনফিগহীন', async () => {
    const { client: adm } = await signedInAdmin(db);
    const r = await adm.get<{
      env: { optional: Array<{ key: string; present: boolean }> };
      health: { subsystems: Array<{ key: string; state: string }> };
    }>('/api/admin/readiness');
    expect(r.status).toBe(200);
    const present = Object.fromEntries(r.body.env.optional.map((o) => [o.key, o.present]));
    for (const k of ['RESEND_API_KEY', 'BLOB_READ_WRITE_TOKEN', 'GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET']) {
      expect(present[k]).toBe(false);
    }
    const tg = r.body.health.subsystems.find((s) => s.key === 'telegram');
    expect(tg?.state).toBe('not_configured');
  });
});
