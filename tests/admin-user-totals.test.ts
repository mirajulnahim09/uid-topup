/**
 * ═══════════════════════════════════════════════════════════
 * ★★★ COR-01 — অ্যাডমিনের গ্রাহক-কার্ড: "মোট খরচ" / "মোট রিচার্জ"
 *
 *   আগে কেবল শেষ ২৫টি অর্ডার/ডিপোজিট থেকে যোগফল, আর আংশিক রিফান্ড বাদ পড়ত না।
 *   দাবি (আসল HTTP, অ্যাডমিন পাতা): ৩০টি সম্পন্ন অর্ডার (একটিতে ৳৩০ রিফান্ড),
 *   বাতিল/ব্যর্থ/রিফান্ডেড অর্ডার ও অননুমোদিত ডিপোজিট বাদ দিয়ে হুবহু সঠিক অঙ্ক;
 *   শূন্য-ইতিহাসে ৳০.০০।
 * ═══════════════════════════════════════════════════════════
 */
import { describe, it, expect } from 'vitest';
import { db } from '../vitest.setup';
import { signedInAdmin } from './helpers/app';
import { createUser, createVariant, createCompletedOrder } from './helpers/factories';

async function cardText(adminClient: Awaited<ReturnType<typeof signedInAdmin>>['client'], userId: string) {
  const r = await adminClient.raw(`/admin/users/${userId}`);
  expect(r.status).toBe(200);
  return (await r.text()).replace(/<!-- -->/g, '');
}

describe('COR-01 — গ্রাহক-কার্ডের যোগফল সম্পূর্ণ ইতিহাস থেকে', () => {
  it('৩০ সম্পন্ন অর্ডার (১টিতে আংশিক রিফান্ড) ও ২৮ অনুমোদিত ডিপোজিট → সঠিক অঙ্ক', async () => {
    const { client: adm } = await signedInAdmin(db);
    const u = await createUser(db);
    const v = await createVariant(db);
    for (let i = 0; i < 30; i++) {
      await createCompletedOrder(db, { userId: u.id, variantId: v.id, price: 100, refundedAmount: i === 0 ? 30 : 0 });
    }
    // বাদ পড়ার কথা: পূর্ণ রিফান্ড, ব্যর্থ, চলমান
    for (const status of ['REFUNDED', 'FAILED', 'PENDING'] as const) {
      const o = await createCompletedOrder(db, { userId: u.id, variantId: v.id, price: 500 });
      await db.order.update({ where: { id: o.id }, data: { status } });
    }
    for (let i = 0; i < 31; i++) {
      await db.deposit.create({
        data: {
          userId: u.id, method: 'BKASH', amount: 200, trxId: `COR01TRX${i}X`, senderNo: '01711111111',
          status: i < 28 ? 'APPROVED' : 'REJECTED',
        },
      });
    }
    const html = await cardText(adm, u.id);
    // ৩০ × ৳১০০ − ৳৩০ = ৳২,৯৭০ ; ২৮ × ৳২০০ = ৳৫,৬০০ (পুরনো ২৫-সীমায় ভুল হতো)
    expect(html).toContain('৳2,970.00');
    expect(html).toContain('৳5,600.00');
  });

  it('কোনো ইতিহাস নেই → ৳০.০০', async () => {
    const { client: adm } = await signedInAdmin(db);
    const u = await createUser(db);
    const html = await cardText(adm, u.id);
    const zeros = html.match(/৳0\.00/g) || [];
    expect(zeros.length).toBeGreaterThanOrEqual(3); // ব্যালেন্স, খরচ, রিচার্জ
  });
});
