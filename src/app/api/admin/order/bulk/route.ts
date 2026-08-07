import { prisma } from '@/lib/prisma';
import { requireAdmin, apiError, ApiError, readJson } from '@/lib/guard';
import { adminOrderBulkSchema } from '@/lib/validation';
import { adminLog } from '@/lib/adminLog';
import { getIp } from '@/lib/rateLimit';
import { notify } from '@/lib/notify';
import { emailOrderCompleted } from '@/lib/email';
import { claimState, isBlockedByOther } from '@/lib/orderClaim';
import { applyOrderStatus, MAX_BULK } from '@/lib/fulfilment';

/**
 * ★★★ বাল্ক অ্যাকশন — সীমাবদ্ধ (3.8)
 *
 *   ── সবচেয়ে গুরুত্বপূর্ণ সীমা: কোন কাজ বাল্কে করা যায় না ──
 *
 *   এখানে **শুধু সেই কাজগুলো** আছে যেগুলোতে এক পয়সাও নড়ে না:
 *   CLAIM, PROCESSING, COMPLETE।
 *
 *   ইচ্ছাকৃতভাবে **বাদ**:
 *
 *   • **ডিপোজিট অনুমোদন** — এটি ব্যালেন্সে টাকা ঢোকায়। পুরো
 *     ব্যবসার নিরাপত্তা দাঁড়িয়ে আছে একটি শর্তের উপর: মানুষ
 *     bKash/Nagad অ্যাপে **প্রতিটি** TrxID নিজে মিলিয়ে দেখে
 *     (CLAUDE.md §11)। বাল্ক অনুমোদনের বাস্তব অর্থ হলো সেই
 *     মিলিয়ে দেখাটা আর হচ্ছে না — বোতামটি থাকলেই অভ্যাস বদলে যায়।
 *     তাই এটি কেবল একক পথেই থাকে।
 *
 *   • **অর্ডার FAIL** — এটি স্বয়ংক্রিয় রিফান্ড চালায় (ব্যালেন্স +
 *     স্টক + কুপন + লেজার)। বাল্কে ভুল করলে বহু গ্রাহকের হিসাব
 *     একসাথে বিগড়ে যেত। রিফান্ড পথ 3.8 এ **স্পর্শই করা হয়নি**।
 *
 *   ── বাকি সীমাগুলো ──
 *   • সর্বোচ্চ MAX_BULK টি — "সব সিলেক্ট" করে হাজারটা চাপা যায় না
 *   • প্রতিটি আইটেম **নিজস্ব transaction**-এ — একটার ব্যর্থতা
 *     বাকিগুলো রোলব্যাক করে না, আর Neon-এ দীর্ঘ transaction টাইমআউটও হয় না
 *   • প্রতিটি আইটেম আলাদা করে অডিট লগ হয় — "বাল্ক" বলে দায় কমে না
 *   • ফলাফল আইটেম-ভিত্তিক ফেরত যায়; আংশিক সফলতা আংশিক বলেই জানানো হয়
 */
export async function POST(req: Request) {
  try {
    const admin = await requireAdmin();

    const parsed = adminOrderBulkSchema.safeParse(await readJson(req));
    if (!parsed.success) throw new ApiError(parsed.error.errors[0].message, 400);

    const { orderIds, action } = parsed.data;

    // ★ একই id দুবার এলে দুবার কাজ করার দরকার নেই
    const ids = [...new Set(orderIds)];
    if (ids.length > MAX_BULK) {
      throw new ApiError(`একসাথে সর্বোচ্চ ${MAX_BULK} টি করা যায়`, 400);
    }

    type Row = { orderId: string; orderNo: number | null; ok: boolean; error?: string };
    const results: Row[] = [];

    for (const orderId of ids) {
      try {
        const out = await prisma.$transaction(
          async (tx) => {
            // ★ একক পথের মতোই row-lock — বাল্ক বলে শিথিল নয়
            const locked = await tx.$queryRaw<
              Array<{
                id: string;
                status: string;
                orderNo: number;
                claimedById: string | null;
                claimedByName: string | null;
                claimedAt: Date | null;
              }>
            >`SELECT id, status, "orderNo", "claimedById", "claimedByName", "claimedAt"
                FROM "Order" WHERE id = ${orderId} FOR UPDATE`;

            const row = locked[0];
            if (!row) throw new ApiError('অর্ডার পাওয়া যায়নি', 404);

            if (row.status !== 'PENDING' && row.status !== 'PROCESSING') {
              throw new ApiError('আর পরিবর্তন করা যাবে না', 409);
            }

            // ★ claim পাহারা (3.7) — বাল্কে **কখনো** টেক-ওভার করা যায় না।
            //   অন্যের কাজ কেড়ে নেওয়া সচেতন একক সিদ্ধান্ত হওয়া উচিত,
            //   ২০টা চেকবক্সের পার্শ্বপ্রতিক্রিয়া নয়।
            const st = claimState(row, admin.id);
            if (isBlockedByOther(st)) {
              throw new ApiError(
                `${st.state === 'held' ? st.byName : 'অন্য অ্যাডমিন'} কাজ করছেন — বাদ দেওয়া হলো`,
                409
              );
            }

            if (action === 'CLAIM') {
              await tx.order.update({
                where: { id: orderId },
                data: {
                  claimedById: admin.id,
                  claimedByName: admin.name,
                  claimedAt: new Date(),
                },
              });
              return { orderNo: row.orderNo, notifyUser: null };
            }

            await applyOrderStatus(tx, { orderId, action, admin });

            const o = await tx.order.findUnique({
              where: { id: orderId },
              select: {
                orderNo: true, productName: true, variantName: true,
                user: { select: { id: true, name: true, email: true } },
              },
            });
            return { orderNo: row.orderNo, notifyUser: o };
          },
          { timeout: 15000 }
        );

        results.push({ orderId, orderNo: out.orderNo, ok: true });

        // ★ অডিট — প্রতিটি আলাদা এন্ট্রি
        adminLog({
          adminId: admin.id,
          adminName: admin.name,
          action:
            action === 'COMPLETE' ? 'ORDER_COMPLETE'
            : action === 'PROCESSING' ? 'ORDER_PROCESSING'
            : 'ORDER_CLAIM',
          targetId: orderId,
          detail: `#${out.orderNo} — বাল্ক (${ids.length} টির মধ্যে)`,
          ip: getIp(req),
        }).catch(() => {});

        // ★ গ্রাহককে জানানো — transaction এর বাইরে, ব্যর্থ হলেও
        //   স্ট্যাটাস পরিবর্তন টেকে
        const u = out.notifyUser;
        if (u) {
          if (action === 'COMPLETE') {
            notify(
              u.user.id,
              `অর্ডার #${u.orderNo} সম্পন্ন 🎉`,
              `${u.productName} — ${u.variantName} ডেলিভারি হয়েছে।`,
              '/account/orders'
            ).catch(() => {});
            emailOrderCompleted(
              u.user.email, u.user.name, u.orderNo, u.productName, u.variantName
            ).catch(() => {});
          } else {
            notify(
              u.user.id,
              `অর্ডার #${u.orderNo} প্রসেসিং ⏳`,
              'আপনার অর্ডার প্রসেস করা হচ্ছে।',
              '/account/orders'
            ).catch(() => {});
          }
        }
      } catch (e) {
        // ★ একটার ব্যর্থতা বাকিগুলো থামায় না — কিন্তু চেপেও যাওয়া হয় না
        results.push({
          orderId,
          orderNo: null,
          ok: false,
          error: e instanceof ApiError ? e.message : 'করা যায়নি',
        });
      }
    }

    const okCount = results.filter((r) => r.ok).length;
    return Response.json({
      success: true,
      okCount,
      failCount: results.length - okCount,
      results,
    });
  } catch (e) {
    return apiError(e);
  }
}
