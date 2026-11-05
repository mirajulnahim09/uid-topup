/**
 * ═══════════════════════════════════════════════════════════
 * ★★★ BKP-01 — নিরাপদ restore
 *
 *   আগে: checksum গোপন-চাবিহীন ছিল (সম্পাদিত ফাইলে নতুন checksum বসালেই পাস),
 *   checksum-বিহীন ফাইলও চলত, পেমেন্ট নাম্বার সবসময় ওভাররাইট হতো, কুপনের
 *   ব্যবহার-গণনা পিছিয়ে যেত, আর যেকোনো সেটিং-কী লেখা যেত। এখানকার দাবি
 *   (প্রতিটি নেতিবাচকের পাশে ইতিবাচক নিয়ন্ত্রণ):
 *     · সার্ভারের স্বাক্ষরিত ফাইল restore হয়
 *     · সম্পাদিত (checksum আবার হিসাব করা) ফাইল ৪০০, DB-তে একটি বাইটও বদলায় না
 *     · স্বাক্ষরহীন ফাইল ৪০০
 *     · পেমেন্ট নাম্বার ডিফল্টে অক্ষত; কেবল `includePaymentChannels: true`-এ ফেরে
 *     · অনুমোদনহীন সেটিং-কী ফিরে আসে না (স্বাক্ষরিত ফাইলে থাকলেও)
 *     · কুপনের ব্যবহার-গণনা কখনো পিছিয়ে যায় না
 *     · restore-এর পরে সেটিংস **সাথে সাথে** কার্যকর (ক্যাশ বাতিল)
 * ═══════════════════════════════════════════════════════════
 */
import { describe, it, expect } from 'vitest';
import { db } from '../vitest.setup';
import { signedInAdmin, signedInUser } from './helpers/app';
import { createCoupon } from './helpers/factories';
import { computeBackupChecksum } from '../src/lib/backup';
import type { Client } from './helpers/http';

async function takeBackup(adm: Client) {
  const res = await adm.raw('/api/admin/backup');
  expect(res.status).toBe(200);
  return JSON.parse(await res.text());
}

async function restore(adm: Client, data: unknown, extra: Record<string, unknown> = {}) {
  return adm.post<{ success?: boolean; error?: string; skippedSettings?: string[] }>(
    '/api/admin/restore',
    { confirm: 'RESTORE', data, ...extra },
  );
}

describe('BKP-01 — ব্যাকআপ restore', () => {
  it('পেমেন্ট নাম্বার ডিফল্টে অক্ষত; স্পষ্ট অনুমতিতে ফেরে', async () => {
    const { client: adm } = await signedInAdmin(db);
    const pc = await db.paymentChannel.create({ data: { method: 'BKASH', accountNo: '01711111111' } });
    const backup = await takeBackup(adm);

    // ব্যাকআপের পরে অ্যাডমিন নাম্বার বদলালেন
    await db.paymentChannel.update({ where: { id: pc.id }, data: { accountNo: '01722222222' } });

    const r1 = await restore(adm, backup);
    expect(r1.status).toBe(200);
    expect((await db.paymentChannel.findUnique({ where: { id: pc.id } }))!.accountNo).toBe('01722222222');

    const r2 = await restore(adm, backup, { includePaymentChannels: true });
    expect(r2.status).toBe(200); // ইতিবাচক নিয়ন্ত্রণ: স্বাক্ষরিত ফাইল restore হয়
    expect((await db.paymentChannel.findUnique({ where: { id: pc.id } }))!.accountNo).toBe('01711111111');
  });

  it('সম্পাদিত ফাইল (checksum আবার হিসাব করা) → ৪০০, কিছুই বদলায় না', async () => {
    const { client: adm } = await signedInAdmin(db);
    const pc = await db.paymentChannel.create({ data: { method: 'BKASH', accountNo: '01733333333' } });
    const backup = await takeBackup(adm);

    // আক্রমণকারীর কাজ: নাম্বার বদলে checksum নতুন করে বসানো
    const row = backup.paymentChannels.find((p: { id: number }) => p.id === pc.id);
    row.accountNo = '01999999999';
    backup._meta.checksum = computeBackupChecksum(backup);

    const r = await restore(adm, backup, { includePaymentChannels: true });
    expect(r.status).toBe(400);
    expect((await db.paymentChannel.findUnique({ where: { id: pc.id } }))!.accountNo).toBe('01733333333');
  });

  it('স্বাক্ষরহীন ফাইল → ৪০০', async () => {
    const { client: adm } = await signedInAdmin(db);
    const backup = await takeBackup(adm);
    delete backup._meta.signature;
    const r = await restore(adm, backup);
    expect(r.status).toBe(400);
  });

  it('অনুমোদনহীন সেটিং-কী স্বাক্ষরিত ফাইলে থাকলেও ফিরে আসে না', async () => {
    const { client: adm } = await signedInAdmin(db);
    await db.setting.create({ data: { key: 'bkp_not_allowed_key', value: 'x' } });
    await db.setting.upsert({ where: { key: 'site_notice' }, create: { key: 'site_notice', value: 'পুরনো নোটিশ' }, update: { value: 'পুরনো নোটিশ' } });
    const backup = await takeBackup(adm);

    await db.setting.delete({ where: { key: 'bkp_not_allowed_key' } });
    await db.setting.update({ where: { key: 'site_notice' }, data: { value: 'নতুন নোটিশ' } });

    const r = await restore(adm, backup);
    expect(r.status).toBe(200);
    expect(r.body.skippedSettings).toContain('bkp_not_allowed_key');
    expect(await db.setting.findUnique({ where: { key: 'bkp_not_allowed_key' } })).toBeNull();
    // ইতিবাচক নিয়ন্ত্রণ: অনুমোদিত কী ফেরে
    expect((await db.setting.findUnique({ where: { key: 'site_notice' } }))!.value).toBe('পুরনো নোটিশ');
  });

  it('কুপনের ব্যবহার-গণনা পিছিয়ে যায় না', async () => {
    const { client: adm } = await signedInAdmin(db);
    const c = await createCoupon(db, { usageLimit: 1 });
    const backup = await takeBackup(adm); // usageCount = 0 সময়ের ফাইল

    await db.coupon.update({ where: { id: c.id }, data: { usageCount: 1 } }); // সীমা শেষ
    expect((await restore(adm, backup)).status).toBe(200);
    expect((await db.coupon.findUnique({ where: { id: c.id } }))!.usageCount).toBe(1);
  });

  it('restore-এর পরে সেটিং সাথে সাথে কার্যকর (৩০s ক্যাশ বাতিল)', async () => {
    const { client: adm } = await signedInAdmin(db);
    await adm.post('/api/admin/settings', { min_deposit: '20', max_deposit: '25000' });
    const backup = await takeBackup(adm); // min_deposit = 20

    await adm.post('/api/admin/settings', { min_deposit: '500', max_deposit: '25000' });
    const { client: cust } = await signedInUser(db, {});
    const dep = (trx: string) => cust.post('/api/deposit', {
      method: 'BKASH', amount: 100, trxId: trx, senderNo: '01812345678',
    });
    expect((await dep(`BKPA${Date.now()}`)).status).toBe(400); // ক্যাশে এখন ৫০০

    expect((await restore(adm, backup)).status).toBe(200);
    expect((await dep(`BKPB${Date.now()}`)).status).toBe(200); // সাথে সাথে ২০
  });
});
