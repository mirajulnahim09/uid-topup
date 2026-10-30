/**
 * ═══════════════════════════════════════════════════════════
 * ★★★ স্ট্রিম-ব্যাকআপ — restore-সামঞ্জস্য
 *
 *   সিমুলেশনে (২০২৬-০৯-২৫, ৫ লাখ অর্ডার) পুরনো ব্যাকআপ পুরো DB একটি
 *   স্ট্রিং-এ বানাতে গিয়ে সার্ভার-প্রসেসকে heap-OOM-এ মেরেছিল। এখন স্ট্রিম।
 *   এই টেস্ট প্রমাণ করে যে নতুন ফাইলটি **পুরনো `verifyBackup()`-এ পাস করে**
 *   (checksum হুবহু একই canonical বাইটের উপর), ব্যাচ-সীমা পেরোলেও সারি
 *   হারায় না/দ্বিগুণ হয় না, আর পাসওয়ার্ড-হ্যাশ যায় না।
 * ═══════════════════════════════════════════════════════════
 */
import { describe, it, expect } from 'vitest';
import { db } from '../vitest.setup';
import { signedInAdmin } from './helpers/app';
import { createUser } from './helpers/factories';
import { verifyBackup } from '../src/lib/backup';
import { TEST_BACKUP_SIGNING_KEY } from './helpers/testEnv';

// ★ BKP-01 — টেস্ট-প্রসেসও সার্ভারের একই (টেস্ট-কেবল) স্বাক্ষর-চাবি জানে
process.env.BACKUP_SIGNING_KEY = TEST_BACKUP_SIGNING_KEY;

describe('অ্যাডমিন ব্যাকআপ — স্ট্রিম', () => {
  it('ফাইলটি verifyBackup পাস করে, সব ইউজার ঠিক একবার, পাসওয়ার্ড নেই', async () => {
    // ★ ব্যাচ ২০০০ — তার বেশি ইউজার বানিয়ে পাতা-সীমা পার করানো
    const run = String(Date.now() % 1000).padStart(3, '0');
    await db.user.createMany({
      data: Array.from({ length: 2105 }, (_, i) => ({
        name: `ব্যাকআপ ${i}`, email: `bk-${run}-${i}@test.local`,
        phone: `0159${run}${String(i).padStart(4, '0')}`,        // ১১ অঙ্ক, প্রতি রানে আলাদা
        password: 'not-a-real-hash', referralCode: `BK${run}X${i}`,
      })),
    });
    await createUser(db, {});
    const { client: a } = await signedInAdmin(db);

    const res = await a.raw('/api/admin/backup');
    expect(res.status).toBe(200);
    const text = await res.text();
    const data = JSON.parse(text);

    expect(data._meta.signature).toMatch(/^[0-9a-f]{64}$/); // BKP-01: HMAC স্বাক্ষর আছে
    expect(verifyBackup(data)).toEqual({ ok: true, version: data._meta.version });
    const dbUsers = await db.user.count();
    expect(data.users).toHaveLength(dbUsers);
    expect(new Set(data.users.map((u: { id: string }) => u.id)).size).toBe(dbUsers);
    expect(data.users.every((u: Record<string, unknown>) => !('password' in u))).toBe(true);

    // ★ একটি বাইট বদলালে checksum ধরে (অখণ্ডতা-পাহারা অক্ষত)
    data.users[0].name = 'বদলানো';
    expect(verifyBackup(data).ok).toBe(false);
  });
});
