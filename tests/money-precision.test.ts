/**
 * ═══════════════════════════════════════════════════════════
 * ★★★ টাকার দশমিক — খতিয়ান ও ব্যালেন্স কখনো আলাদা পথে গোল হবে না
 *   (EXTREME রেড-টিম, ২০২৬-০৯-২১)
 *
 *   `balance` ও `LedgerEntry.amount` দুটোই `numeric(12,2)`। Postgres
 *   ২ দশমিকের বেশি অঙ্ক "half away from zero" নিয়মে গোল করে — কিন্তু
 *   **দুটি আলাদা জায়গায়**: ব্যালেন্সে গোল হয় যোগফলের উপর (`10.00 − 0.125
 *   = 9.875 → 9.88`), খতিয়ানে গোল হয় অঙ্কটির উপর (`−0.125 → −0.13`)।
 *   ফলে একটি কর্তনেই যোগফল ≠ ব্যালেন্স — CLAUDE.md-এর মূল invariant ভাঙে।
 *
 *   একমাত্র পথ যেখানে ৩-দশমিকের অঙ্ক সরাসরি ওয়ালেটে পৌঁছায়: অ্যাডমিনের
 *   ব্যালেন্স-সমন্বয় (অর্ডার/প্রত্যাহার/রিফান্ড আগেই `round2` করে)।
 * ═══════════════════════════════════════════════════════════
 */
import { describe, it, expect } from 'vitest';
import { db } from '../vitest.setup';
import { signedInAdmin } from './helpers/app';
import { createUser, balanceOf, ledgerSum } from './helpers/factories';

describe('অ্যাডমিন সমন্বয় — দশমিক', () => {
  it('২ দশমিকের বেশি কর্তন খতিয়ান-ব্যালেন্স অমিল তৈরি করে না', async () => {
    const { client: adm } = await signedInAdmin(db);
    const user = await createUser(db, { balance: 0 });

    const start = await adm.post('/api/admin/user', { userId: user.id, amount: 10, note: 'শুরুর ব্যালেন্স' });
    expect(start.status).toBe(200);

    const r = await adm.post('/api/admin/user', { userId: user.id, amount: -0.125, note: 'দশমিক পরীক্ষা' });

    // ★ মূল দাবি — যা-ই ঘটুক, যোগফল = ব্যালেন্স
    expect(await balanceOf(db, user.id)).toBe(await ledgerSum(db, user.id));
    // ★ এবং অঙ্কটি নীরবে গোল না হয়ে পরিষ্কারভাবে ফেরত যায়
    expect(r.status).toBe(400);
    expect(await balanceOf(db, user.id)).toBe(10);
  });

  it('২ দশমিকের বেশি যোগও প্রত্যাখ্যাত; ২ দশমিক পর্যন্ত আগের মতোই চলে', async () => {
    const { client: adm } = await signedInAdmin(db);
    const user = await createUser(db, { balance: 0 });

    expect((await adm.post('/api/admin/user', { userId: user.id, amount: 0.004, note: 'শূন্য-গোল' })).status).toBe(400);
    expect((await adm.post('/api/admin/user', { userId: user.id, amount: 12.345, note: 'তিন দশমিক' })).status).toBe(400);
    expect(await db.ledgerEntry.count({ where: { userId: user.id } })).toBe(0);

    expect((await adm.post('/api/admin/user', { userId: user.id, amount: 0.1, note: 'এক দশমিক' })).status).toBe(200);
    expect((await adm.post('/api/admin/user', { userId: user.id, amount: 0.2, note: 'এক দশমিক' })).status).toBe(200);
    expect((await adm.post('/api/admin/user', { userId: user.id, amount: -0.07, note: 'দুই দশমিক' })).status).toBe(200);
    expect(await balanceOf(db, user.id)).toBe(0.23);
    expect(await ledgerSum(db, user.id)).toBe(0.23);
  });
});
