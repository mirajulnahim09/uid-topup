import { prisma } from '@/lib/prisma';
import { requireAdmin, apiError, ApiError } from '@/lib/guard';
import { adminPartialRefundSchema } from '@/lib/validation';
import { adminLog } from '@/lib/adminLog';
import { getIp } from '@/lib/rateLimit';
import { notify } from '@/lib/notify';
import { cleanText } from '@/lib/sanitize';
import { recordOrderEvent } from '@/lib/orderEvents';
import { round2 } from '@/lib/money';
import { creditWallet } from '@/lib/services/wallet';

/**
 * ★★★ আংশিক রিফান্ড (3.14)
 *
 *   ব্যবহার: ডেলিভারি হয়েছে কিন্তু পুরোটা নয়, বা দেরির ক্ষতিপূরণ।
 *   পুরো অর্ডার বাতিল করলে বেশি ফেরত যেত — সেটা ভুল।
 *
 *   ── সুরক্ষার কাঠামো ──
 *
 *   ১. **একটাই অপরিবর্তনীয় নিয়ম:** `refundedAmount + অঙ্ক <= price`।
 *      লক করা রো থেকে পড়া হয়, তাই দুজন অ্যাডমিন একসাথে চাপলেও
 *      দ্বিতীয়জন প্রথমজনের হালনাগাদ করা মান দেখে — যোগফল কখনো
 *      দাম ছাড়ায় না।
 *
 *   ২. **পূর্ণ রিফান্ডও একই নিয়মে বাঁধা।** FAIL পথ
 *      `refundedAmount = price` বসায়, তাই পুরো ফেরত হওয়া অর্ডারে
 *      এই এন্ডপয়েন্ট আপনাআপনি আটকে যায় — আলাদা পাহারা লাগে না।
 *
 *   ৩. **স্টক ও কুপন ফেরত যায় না** — ইচ্ছাকৃত। জিনিস আংশিক হলেও
 *      পৌঁছেছে, অর্ডারটি বহাল। কুপন ফেরত দিলে গ্রাহক পণ্যও রাখত,
 *      কুপনও ফিরে পেত। এটাই পূর্ণ রিফান্ডের সাথে মূল পার্থক্য।
 *
 *   ৪. **শুধু COMPLETED অর্ডারে।** চলমান অর্ডারের জন্য আগের FAIL
 *      পথই আছে (পুরো ফেরত + স্টক + কুপন) — দুটো পথ একই কাজ করে না,
 *      তাই বিভ্রান্তিও নেই।
 */
export async function POST(req: Request) {
  try {
    const admin = await requireAdmin();

    const parsed = adminPartialRefundSchema.safeParse(await req.json());
    if (!parsed.success) throw new ApiError(parsed.error.errors[0].message, 400);

    const { orderId } = parsed.data;
    const amount = round2(parsed.data.amount);
    const reason = cleanText(parsed.data.reason, 300);

    const out = await prisma.$transaction(
      async (tx) => {
        // ★★★ ROW LOCK — refundedAmount পড়া-যাচাই-লেখা একটাই
        //     অবিভাজ্য ধাপ হতে হবে, নইলে দুটো সমান্তরাল অনুরোধ
        //     দুজনেই পুরনো মান দেখে দুবার ফেরত দিত
        const locked = await tx.$queryRaw<
          Array<{
            id: string; status: string; orderNo: number;
            price: string; refundedAmount: string; userId: string;
          }>
        >`SELECT id, status, "orderNo", price, "refundedAmount", "userId"
            FROM "Order" WHERE id = ${orderId} FOR UPDATE`;

        const row = locked[0];
        if (!row) throw new ApiError('অর্ডার পাওয়া যায়নি', 404);

        if (row.status !== 'COMPLETED') {
          throw new ApiError(
            'শুধু সম্পন্ন অর্ডারে আংশিক ফেরত দেওয়া যায়। চলমান অর্ডার বাতিল করলে এমনিতেই পুরো টাকা ফেরত যায়।',
            409
          );
        }

        const price = round2(Number(row.price));
        const already = round2(Number(row.refundedAmount));
        const remaining = round2(price - already);

        if (remaining <= 0) {
          throw new ApiError('এই অর্ডারের পুরো টাকা ইতিমধ্যে ফেরত দেওয়া হয়েছে', 409);
        }
        // ★★★ মূল নিয়ম
        if (amount > remaining) {
          throw new ApiError(
            `সর্বোচ্চ ৳${remaining.toFixed(2)} ফেরত দেওয়া যাবে (মোট ৳${price.toFixed(2)}, আগে ফেরত ৳${already.toFixed(2)})`,
            400
          );
        }

        // ★ ব্যালেন্স + খতিয়ান একসাথে — §8 এর নিয়ম এখন কাঠামোগত (4.1)
        await creditWallet({
          tx,
          userId: row.userId,
          amount,
          type: 'REFUND',
          refId: orderId,
          note: `অর্ডার #${row.orderNo} — আংশিক ফেরত: ${reason}`,
        });

        await tx.order.update({
          where: { id: orderId },
          data: { refundedAmount: round2(already + amount) },
        });

        await recordOrderEvent(tx, {
          orderId,
          status: 'COMPLETED',
          note: `আংশিক ফেরত ৳${amount.toFixed(2)} — ${reason}`,
          actorType: 'ADMIN',
          actorId: admin.id,
        });

        return {
          orderNo: row.orderNo,
          userId: row.userId,
          totalRefunded: round2(already + amount),
          price,
        };
      },
      { timeout: 15000 }
    );

    adminLog({
      adminId: admin.id,
      adminName: admin.name,
      action: 'ORDER_PARTIAL_REFUND',
      targetId: orderId,
      amount,
      detail: `#${out.orderNo} — ৳${amount.toFixed(2)} ফেরত (মোট ৳${out.totalRefunded.toFixed(2)} / ৳${out.price.toFixed(2)}) — ${reason}`,
      ip: getIp(req),
    }).catch(() => {});

    await notify(
      out.userId,
      `অর্ডার #${out.orderNo} — ৳${amount.toFixed(2)} ফেরত`,
      reason,
      '/account'
    );

    return Response.json({ success: true, totalRefunded: out.totalRefunded });
  } catch (e) {
    return apiError(e);
  }
}
