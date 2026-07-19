import type { Prisma, OrderStatus, OrderActorType } from '@prisma/client';

/**
 * ═══════════════════════════════════════════════════════════
 * ★ অর্ডারের ঘটনাপঞ্জি লেখা — append-only
 *
 *   কেন: গ্রাহকের সবচেয়ে বড় প্রশ্ন "আমার অর্ডার কোথায়?"।
 *   শুধু বর্তমান status দেখালে সে জানে না কখন কী হয়েছে।
 *   প্রতিটি ধাপ সময়সহ রাখলে —
 *     • গ্রাহক নিজেই দেখে নিতে পারে (সাপোর্ট টিকিট কমে)
 *     • বিরোধ হলে সঠিক সময়রেখা প্রমাণ হিসেবে থাকে
 *
 *   ⚠️ এই সারিগুলো কখনো UPDATE/DELETE করা হবে না —
 *      LedgerEntry এর মতোই অপরিবর্তনীয় নথি।
 *
 *   ⚠️ টাকার transaction এর ভেতরে ডাকলে `tx` পাঠান, যাতে
 *      অর্ডার ও তার ঘটনা একসাথেই commit/rollback হয়।
 * ═══════════════════════════════════════════════════════════
 */
export async function recordOrderEvent(
  client: Prisma.TransactionClient,
  input: {
    orderId: string;
    status: OrderStatus;
    note?: string | null;
    actorType?: OrderActorType;
    actorId?: string | null;
  }
): Promise<void> {
  await client.orderEvent.create({
    data: {
      orderId: input.orderId,
      status: input.status,
      note: input.note ?? null,
      actorType: input.actorType ?? 'SYSTEM',
      actorId: input.actorId ?? null,
    },
  });
}
