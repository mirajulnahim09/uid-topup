import { prisma } from '@/lib/prisma';
import { requireUser, apiError } from '@/lib/guard';

// সেশন-নির্ভর — কখনো ক্যাশ হবে না
export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const user = await requireUser();
    const u = await prisma.user.findUnique({
      where: { id: user.id },
      select: { balance: true, name: true, referralCode: true },
    });
    return Response.json({
      balance: Number(u?.balance ?? 0).toFixed(2),
      name: u?.name,
      referralCode: u?.referralCode,
    });
  } catch (e) {
    return apiError(e);
  }
}
