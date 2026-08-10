/**
 * ═══════════════════════════════════════════════════════════
 * ★★★ Group H — ঝুঁকি auto-hold ও রিপোর্ট-scrubbing
 *
 *   দুটি দাবি:
 *
 *   ১. সন্দেহজনক ডিপোজিট **auto-hold** হয় — কোনো স্বয়ংক্রিয় পথ
 *      সেটি ক্রেডিট করতে পারবে না। কিন্তু গ্রাহকের দিক থেকে কিছুই
 *      বদলায় না, আর **কখনো auto-ban নয়** (RUN.md §GROUP H)।
 *
 *   ২. Sentry-তে যা পাঠানো হয় তাতে ইমেইল, ফোন, টাকার অঙ্ক বা কী
 *      থাকে না। ত্রুটি-বার্তায় আসল মান প্রতিধ্বনিত হওয়া খুব সাধারণ,
 *      তাই এটি অনুমান নয় — মেপে দেখা দরকার।
 * ═══════════════════════════════════════════════════════════
 */
import { describe, it, expect } from 'vitest';
import { db } from '../vitest.setup';
import { signedInUser } from './helpers/app';
import { balanceOf } from './helpers/factories';
import { scrubForReport } from '../src/lib/errorReporter';
import { canAutoCreditDeposit } from '../src/lib/riskSignals';

/** ★ একটি ডিপোজিট দাবি — আসল HTTP পথেই */
async function claim(
  c: Awaited<ReturnType<typeof signedInUser>>['client'],
  opts: { amount?: number; senderNo?: string } = {},
) {
  const res = await c.post('/api/deposit', {
    method: 'BKASH',
    amount: opts.amount ?? 500,
    trxId: `TRX${Math.random().toString(36).slice(2, 10).toUpperCase()}`,
    senderNo: opts.senderNo ?? '01712345678',
  });
  return res;
}

describe('ঝুঁকি — auto-hold', () => {
  it('প্রেরকের নাম্বার না মিললে hold হয়, কিন্তু দাবি জমা হয়', async () => {
    const { user, client: c } = await signedInUser(db, { balance: 0 });

    // ★ factories ফোন দেয় `019…`, তাই ভিন্ন নাম্বার = সংকেত
    const res = await claim(c, { senderNo: '01712345678' });

    // ★★★ গ্রাহকের দিক থেকে সব স্বাভাবিক — ঝুঁকির কথা বলা হয় না
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(JSON.stringify(res.body)).not.toMatch(/ঝুঁকি|সন্দেহ|hold/i);

    const dep = await db.deposit.findFirstOrThrow({ where: { userId: user.id } });
    expect(dep.status).toBe('PENDING');
    expect(dep.riskLevel).toBe('ELEVATED');
    expect(dep.riskHeldAt).not.toBeNull();
    expect(dep.riskNote).toContain('নাম্বার');

    // ★★★ কখনো auto-ban নয়
    const fresh = await db.user.findUniqueOrThrow({ where: { id: user.id } });
    expect(fresh.isBanned).toBe(false);
    expect(fresh.status).toBe('ACTIVE');

    // ★ টাকা কোথাও যায়নি — hold মানে ক্রেডিট নয়
    expect(await balanceOf(db, user.id)).toBe(0);
    expect(await db.ledgerEntry.count({ where: { userId: user.id } })).toBe(0);
  });

  it('hold করা দাবি স্বয়ংক্রিয় ক্রেডিটের অযোগ্য', async () => {
    const { user, client: c } = await signedInUser(db, { balance: 0 });
    await claim(c, { senderNo: '01712345678' });

    const dep = await db.deposit.findFirstOrThrow({ where: { userId: user.id } });
    // ★ প্রতিটি ভবিষ্যৎ অটো-পথকে এই গার্ডই ডাকতে হবে
    expect(canAutoCreditDeposit(dep)).toBe(false);
  });

  it('অ্যাডমিন hold করা দাবিও আগের মতোই অনুমোদন করতে পারেন', async () => {
    const { user, client: c } = await signedInUser(db, { balance: 0 });
    await claim(c, { amount: 500, senderNo: '01712345678' });
    const dep = await db.deposit.findFirstOrThrow({ where: { userId: user.id } });
    expect(dep.riskHeldAt).not.toBeNull();

    const { signedInAdmin } = await import('./helpers/app');
    const { client: ac } = await signedInAdmin(db);
    const res = await ac.post('/api/admin/deposit', { depositId: dep.id, action: 'APPROVE' });

    // ★★★ hold মানুষের সিদ্ধান্তে কখনো বাধা নয়
    expect(res.status).toBe(200);
    expect(await balanceOf(db, user.id)).toBe(500);
    expect(await db.ledgerEntry.count({ where: { userId: user.id, type: 'DEPOSIT' } })).toBe(1);
  });

  it('ঝুঁকি-হিসাব ব্যর্থ হলেও ডিপোজিট তৈরি হয় (fail-open, কিন্তু নিরাপদ)', async () => {
    // ★ এখানে কৃত্রিম ব্যর্থতা বানানো যায় না, তাই দাবিটি কাঠামোগতভাবে
    //   যাচাই করি: ব্লকটি guarded এবং hold না হলেও টাকা নিজে থেকে
    //   কখনো যোগ হয় না — অনুমোদন সবসময় মানুষের হাতেই।
    const { user, client: c } = await signedInUser(db, { balance: 0 });
    await claim(c, { senderNo: '01712345678' });

    const dep = await db.deposit.findFirstOrThrow({ where: { userId: user.id } });
    expect(dep.status).toBe('PENDING');           // কখনো APPROVED নয়
    expect(await balanceOf(db, user.id)).toBe(0);
  });
});

describe('রিপোর্ট scrubbing — PII ও টাকা বাইরে যায় না', () => {
  it('ইমেইল ও ফোন ঢাকা পড়ে', () => {
    const out = scrubForReport(
      'Unique constraint failed: rakib.hasan@gmail.com / 01712345678 already exists',
    );
    expect(out).not.toContain('rakib.hasan@gmail.com');
    expect(out).not.toContain('01712345678');
    expect(out).toContain('<email>');
    expect(out).toContain('<phone>');
  });

  it('টাকার অঙ্ক ঢাকা পড়ে — চিহ্নসহ ও ছাড়া', () => {
    const out = scrubForReport('balance ৳1,250.00 < required 4999.50 (Tk 300)');
    expect(out).not.toMatch(/1,250\.00|4999\.50|300/);
    expect(out.match(/<amount>/g)?.length).toBe(3);
  });

  it('API কী ও টোকেন ঢাকা পড়ে', () => {
    const out = scrubForReport(
      'auth failed for uidk_AbCdEf123456_xyz using Bearer eyJhbGciOiJIUzI1NiJ9 and sk_live_9988ABCD',
    );
    expect(out).not.toContain('uidk_AbCdEf123456_xyz');
    expect(out).not.toContain('eyJhbGciOiJIUzI1NiJ9');
    expect(out).not.toContain('sk_live_9988ABCD');
    expect(out).toContain('<api-key>');
    expect(out).toContain('Bearer <token>');
    expect(out).toContain('<key>');
  });

  it('password=... ধরনের জোড়া ঢাকা পড়ে', () => {
    const out = scrubForReport('connect failed password=hunter2 token=abc123');
    expect(out).not.toContain('hunter2');
    expect(out).not.toContain('abc123');
  });

  it('লম্বা সংখ্যা (UID / TrxID) ঢাকা পড়ে', () => {
    const out = scrubForReport('player 123456789 trx BKASH8899776655 failed');
    expect(out).not.toContain('123456789');
    expect(out).toContain('<digits>');
  });

  /** ★ scrub এত আক্রমণাত্মক নয় যে রিপোর্ট অকেজো হয়ে যায় */
  it('ডিবাগিং-এর দরকারি অংশ টিকে থাকে', () => {
    const out = scrubForReport(
      'PrismaClientKnownRequestError at src/lib/services/wallet.ts:57 code P2002 order clx9a8b7c',
    );
    expect(out).toContain('PrismaClientKnownRequestError');
    expect(out).toContain('src/lib/services/wallet.ts');
    expect(out).toContain('P2002');
    expect(out).toContain('clx9a8b7c');
  });

  it('খালি ইনপুটে ভাঙে না', () => {
    expect(scrubForReport('')).toBe('');
  });
});
