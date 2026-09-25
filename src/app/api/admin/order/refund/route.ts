import { prisma } from '@/lib/prisma';
import { requireAdmin, apiError, ApiError, readJson } from '@/lib/guard';
import { adminPartialRefundSchema } from '@/lib/validation';
import { getIp } from '@/lib/rateLimit';
import { notify } from '@/lib/notify';
import { telegramEvent } from '@/lib/telegram';
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

    const parsed = adminPartialRefundSchema.safeParse(await readJson(req));
    if (!parsed.success) throw new ApiError(parsed.error.errors[0].message, 400);

    const { orderId, requestId } = parsed.data;
    const amount = round2(parsed.data.amount);
    const reason = cleanText(parsed.data.reason, 300);
    /**
     * ★★★ idempotency — অনুরোধের চাবি এই ফেরতের **অডিট-সারিতেই** থাকে
     *   (`AdminLog.detail`-এর শেষে `[req:<id>]`), এবং সেই সারি এখন টাকার সাথে
     *   একই ট্রানজেকশনে লেখা হয়। ফলে "টাকা গেল কিন্তু চাবি লেখা হয়নি" বা উল্টোটা
     *   অসম্ভব, আর নতুন টেবিল/কলাম (স্কিমা-মাইগ্রেশন) লাগেনি।
     *
     *   ⚠️ মাপা (সিমুলেশন, ২০২৬-০৯-২৫): উত্তর আসার আগে নেট কাটলে অ্যাডমিন আবার
     *   চাপতেন → দুটি ফেরত (সীমার ভেতরে বলে দুটোই বৈধ দেখাত)। এর আগের অস্থায়ী
     *   সমাধান ছিল "একই অঙ্ক+কারণ ২ মিনিটে" অনুমান — মালিকের রিভিউতে বাতিল, কারণ
     *   সেটি ইচ্ছাকৃত দ্বিতীয় ফেরতও আটকাত এবং কেবল লেখার মিলের উপর নির্ভর করত।
     */
    const keyMark = `[req:${requestId}]`;

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

        // ★★★ একই চাবি আগে কাজ করেছে? — Order রো লকের **পরে** খোঁজা, তাই একই
        //   চাবির সমান্তরাল অনুরোধগুলো ক্রমিক: দ্বিতীয়টি প্রথমটির অডিট-সারি দেখে।
        //   সীমা/অবস্থা-যাচাইয়ের **আগে**, যাতে পুরো ফেরতের পরের retry-ও "হয়ে গেছে"
        //   পায়, ভুল করে "আর ফেরত দেওয়া যাবে না" নয়।
        const prior = await tx.adminLog.findFirst({
          where: { action: 'ORDER_PARTIAL_REFUND', targetId: orderId, detail: { endsWith: keyMark } },
          select: { amount: true },
        });
        if (prior) {
          if (round2(Number(prior.amount)) !== amount) {
            throw new ApiError(
              'এই অনুরোধ-আইডি আগে অন্য অঙ্কে ব্যবহার হয়েছে — কিছুই ফেরত দেওয়া হয়নি। পাতাটি রিফ্রেশ করে নতুন করে দিন।',
              409,
              'REQUEST_ID_REUSED',
            );
          }
          return {
            duplicate: true as const,
            orderNo: row.orderNo,
            userId: row.userId,
            totalRefunded: round2(Number(row.refundedAmount)),
            price: round2(Number(row.price)),
          };
        }

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

        // ★★★ অডিট-সারি **একই ট্রানজেকশনে** — এটিই idempotency-চাবির ঘর।
        //   আগে এটি ট্রানজেকশনের পরে best-effort (`adminLog().catch()`) লেখা হতো;
        //   এখন টাকা নড়লে অডিটও নিশ্চিত, না নড়লে কোনোটিই নয়। মানুষ-পড়ার অংশ
        //   ৪৪০ অক্ষরে কাটা, যাতে শেষের চাবি কখনো ৫০০-সীমায় কাটা না পড়ে।
        const totalAfter = round2(already + amount);
        await tx.adminLog.create({
          data: {
            adminId: admin.id,
            adminName: admin.name,
            actorType: 'ADMIN',
            role: 'ADMIN',
            action: 'ORDER_PARTIAL_REFUND',
            targetId: orderId,
            amount,
            detail: `${`#${row.orderNo} — ৳${amount.toFixed(2)} ফেরত (মোট ৳${totalAfter.toFixed(2)} / ৳${price.toFixed(2)}) — ${reason}`.slice(0, 440)} ${keyMark}`,
            ip: getIp(req),
          },
        });

        return {
          duplicate: false as const,
          orderNo: row.orderNo,
          userId: row.userId,
          totalRefunded: round2(already + amount),
          price,
        };
      },
      { timeout: 15000 }
    );

    // ★ একই চাবির পুনরাবৃত্তি — টাকা নড়েনি; বিজ্ঞপ্তি/টেলিগ্রাম আবার নয়
    if (out.duplicate) {
      return Response.json({ success: true, duplicate: true, totalRefunded: out.totalRefunded });
    }

    // ★ guarded (defense-in-depth): notify নিজে throw করে না (ভেতরে
    //   try/catch), তবু .catch() রাখা — refactor-এ throw এলেও order/money
    //   commit-পরবর্তী ব্যর্থতা যেন ইউজারকে ভুল "ব্যর্থ" না দেখায়।
    notify(
      out.userId,
      `অর্ডার #${out.orderNo} — ৳${amount.toFixed(2)} ফেরত`,
      reason,
      '/account'
    ).catch(() => {});

    // ★ অপারেটর-ফিড — আংশিক ফেরতও টাকা বেরোনো, তাই একই ইভেন্ট
    telegramEvent(
      'refund',
      '💸 আংশিক ফেরত',
      `#${out.orderNo} — ৳${amount.toFixed(2)} ফেরত (মোট ৳${out.totalRefunded.toFixed(2)} / ৳${out.price.toFixed(2)}) — ${admin.name} — ${reason}`,
      '/admin/orders',
    );

    return Response.json({ success: true, totalRefunded: out.totalRefunded });
  } catch (e) {
    return apiError(e);
  }
}
