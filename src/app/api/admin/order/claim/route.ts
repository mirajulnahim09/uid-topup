import { prisma } from '@/lib/prisma';
import { requireAdmin, apiError, ApiError, readJson } from '@/lib/guard';
import { adminOrderClaimSchema } from '@/lib/validation';
import { adminLog } from '@/lib/adminLog';
import { getIp } from '@/lib/rateLimit';
import {
  claimState, isBlockedByOther, claimBlockMessage, isAutoFulfillInFlight, AUTO_INFLIGHT_MESSAGE,
} from '@/lib/orderClaim';

/**
 * ★ অর্ডার ধরা / ছাড়া (3.7)
 *
 *   এখানে কোনো টাকা নড়ে না — শুধু "কে কাজ করছে" চিহ্ন।
 *   তবু row-lock ব্যবহার করা হয়েছে, কারণ দুজন একই সেকেন্ডে CLAIM
 *   চাপলে লক ছাড়া দুজনেই "আমি পেয়েছি" উত্তর পেত — অর্থাৎ claim
 *   নিজেই সেই ডাবল-ডেলিভারি ঘটাত যা ঠেকাতে এটি বানানো।
 */
export async function POST(req: Request) {
  try {
    const admin = await requireAdmin();

    const parsed = adminOrderClaimSchema.safeParse(await readJson(req));
    if (!parsed.success) throw new ApiError(parsed.error.errors[0].message, 400);

    const { orderId, action, takeover } = parsed.data;

    const out = await prisma.$transaction(
      async (tx) => {
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

        // ★ শেষ হয়ে যাওয়া অর্ডার ধরার কিছু নেই
        if (row.status !== 'PENDING' && row.status !== 'PROCESSING') {
          throw new ApiError('এই অর্ডার আর প্রক্রিয়াধীন নয়', 409);
        }

        const st = claimState(row, admin.id);

        // ★★★ D1-1 — অটো-ডেলিভারির চলমান claim টেক-ওভার বা ছাড়ানো যায় না।
        //   টেক-ওভার করলে claim অ্যাডমিনের হতো, তারপর তাঁর নিজের FAIL (`mine`)
        //   প্রোভাইডার-কলের মাঝেই রিফান্ড চালাত — একক রুটের পাহারা এড়িয়ে।
        if (isAutoFulfillInFlight(row)) {
          throw new ApiError(AUTO_INFLIGHT_MESSAGE, 409, 'AUTO_IN_FLIGHT');
        }

        if (action === 'RELEASE') {
          // ★ নিজের claim ছাড়া যায়; অন্যেরটা জোর করে ছাড়ানো যায় না —
          //   সেটা টেক-ওভারের কাজ, এবং সেটি লগ হয়।
          if (st.state === 'held') {
            throw new ApiError(claimBlockMessage(st), 409, 'CLAIM_HELD');
          }
          await tx.order.update({
            where: { id: orderId },
            data: { claimedById: null, claimedByName: null, claimedAt: null },
          });
          return { kind: 'RELEASE' as const, orderNo: row.orderNo, prev: st };
        }

        // ── CLAIM ──
        if (isBlockedByOther(st) && !takeover) {
          // ⚠️ 409 — ফ্রন্টএন্ড এটি দেখেই টেক-ওভার নিশ্চিতকরণ দেখায়
          throw new ApiError(claimBlockMessage(st), 409, 'CLAIM_HELD');
        }

        await tx.order.update({
          where: { id: orderId },
          data: {
            claimedById: admin.id,
            claimedByName: admin.name,
            claimedAt: new Date(),
          },
        });

        return {
          kind: st.state === 'held' ? ('TAKEOVER' as const) : ('CLAIM' as const),
          orderNo: row.orderNo,
          prev: st,
        };
      },
      { timeout: 15000 }
    );

    // ★ অডিট — টেক-ওভার আলাদা করে লগ হয়। "আমার অর্ডার কেউ কেড়ে
    //   নিয়েছিল কি না" পরে যাচাই করার একমাত্র উপায় এটাই।
    adminLog({
      adminId: admin.id,
      adminName: admin.name,
      action:
        out.kind === 'TAKEOVER' ? 'ORDER_TAKEOVER'
        : out.kind === 'RELEASE' ? 'ORDER_RELEASE'
        : 'ORDER_CLAIM',
      targetId: orderId,
      detail:
        out.kind === 'TAKEOVER' && out.prev.state === 'held'
          ? `#${out.orderNo} — ${out.prev.byName} (${out.prev.ageMin} মিনিট) থেকে টেক ওভার`
          : `#${out.orderNo}`,
      ip: getIp(req),
    }).catch(() => {});

    return Response.json({ success: true, kind: out.kind });
  } catch (e) {
    return apiError(e);
  }
}
