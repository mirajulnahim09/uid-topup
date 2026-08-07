import type { Prisma } from '@prisma/client';
import { recordOrderEvent } from './orderEvents';

/**
 * ★★★ ফুলফিলমেন্ট — শেয়ার্ড অংশ (3.8)
 *
 *   একক ও বাল্ক — দুই পথেই **একই** কোড চলে। আলাদা "bulk SQL" লেখা
 *   হয়নি ইচ্ছাকৃতভাবে: তাহলে দুটো আলাদা বাস্তবায়ন তৈরি হতো, আর
 *   একটাতে বাগ ঠিক করে অন্যটা ভুলে যাওয়ার ফাঁদ থাকত।
 *
 *   ⚠️ এখানে **শুধু সেই পরিবর্তনগুলো** আছে যেগুলোতে টাকা নড়ে না —
 *   PROCESSING ও COMPLETED। অর্ডারের টাকা আগেই কাটা হয়েছে (অর্ডার
 *   দেওয়ার সময়), তাই ডেলিভারি সম্পন্ন করলে ব্যালেন্স/লেজার কিছুই
 *   বদলায় না।
 *
 *   ⚠️ FAIL → রিফান্ড এখানে **নেই এবং থাকবে না**। সেটি টাকা ফেরত
 *   পাঠায় (ব্যালেন্স + স্টক + কুপন + লেজার), সেটি একমাত্র
 *   `/api/admin/order` এর নিজস্ব transaction-এ থাকে — বাল্কেও যায় না।
 *   এই বিভাজনই 3.8 এর মূল নিরাপত্তা সীমারেখা।
 */

export type NonMoneyOrderAction = 'PROCESSING' | 'COMPLETE';

export async function applyOrderStatus(
  tx: Prisma.TransactionClient,
  args: {
    orderId: string;
    action: NonMoneyOrderAction;
    admin: { id: string; name: string };
    playerName?: string;
    adminNote?: string;
    internalNote?: string;
  }
): Promise<void> {
  const { orderId, action, admin, playerName, adminNote, internalNote } = args;

  if (action === 'PROCESSING') {
    await tx.order.update({
      where: { id: orderId },
      data: {
        status: 'PROCESSING',
        playerName,
        adminNote,
        internalNote,
        // ★ কাজ শুরু = অর্ডার ধরা (3.7)
        claimedById: admin.id,
        claimedByName: admin.name,
        claimedAt: new Date(),
      },
    });
    await recordOrderEvent(tx, {
      orderId,
      status: 'PROCESSING',
      note: 'অ্যাডমিন অর্ডারটি দেখছেন — ডেলিভারি চলছে',
      actorType: 'ADMIN',
      actorId: admin.id,
    });
    return;
  }

  await tx.order.update({
    where: { id: orderId },
    data: {
      status: 'COMPLETED',
      playerName,
      adminNote,
      internalNote,
      completedAt: new Date(),
      // ★ কাজ শেষ — claim ছেড়ে দেওয়া (3.7)
      claimedById: null,
      claimedByName: null,
      claimedAt: null,
    },
  });
  await recordOrderEvent(tx, {
    orderId,
    status: 'COMPLETED',
    note: adminNote || 'ডেলিভারি সম্পন্ন হয়েছে',
    actorType: 'ADMIN',
    actorId: admin.id,
  });
}

/** একসাথে সর্বোচ্চ কতগুলো — "সব সিলেক্ট" করে হাজারটা চাপার পথ বন্ধ */
export const MAX_BULK = 20;
