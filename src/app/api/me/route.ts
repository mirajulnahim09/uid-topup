import { prisma } from '@/lib/prisma';
import { requireUser, apiError } from '@/lib/guard';

// সেশন-নির্ভর — কখনো ক্যাশ হবে না
export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const user = await requireUser();
    const [u, pendingOrders] = await Promise.all([
      prisma.user.findUnique({
        where: { id: user.id },
        select: { balance: true, name: true, referralCode: true },
      }),
      // ★ মোবাইল ট্যাব বারের ব্যাজ — এখনো চলমান অর্ডারের সংখ্যা
      prisma.order.count({
        where: {
          userId: user.id,
          status: { in: ['AWAITING_PAYMENT', 'PENDING', 'PROCESSING'] },
        },
      }),
    ]);
    return Response.json({
      balance: Number(u?.balance ?? 0).toFixed(2),
      name: u?.name,
      referralCode: u?.referralCode,
      pendingOrders,
    });
  } catch (e) {
    return apiError(e);
  }
}
