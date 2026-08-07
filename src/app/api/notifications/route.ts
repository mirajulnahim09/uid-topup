import { prisma } from '@/lib/prisma';
import { requireUser, apiError } from '@/lib/guard';

// সেশন-নির্ভর — কখনো ক্যাশ হবে না
export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const user = await requireUser();
    const [items, unread] = await Promise.all([
      prisma.notification.findMany({
        where: { userId: user.id },
        orderBy: { createdAt: 'desc' },
        take: 20,
      }),
      prisma.notification.count({ where: { userId: user.id, isRead: false } }),
    ]);

    return Response.json({
      unread,
      items: items.map((n: (typeof items)[number]) => ({
        id: n.id,
        title: n.title,
        body: n.body,
        link: n.link,
        isRead: n.isRead,
        createdAt: n.createdAt.toISOString(),
      })),
    });
  } catch (e) {
    return apiError(e);
  }
}

export async function PATCH() {
  try {
    const user = await requireUser();
    await prisma.notification.updateMany({
      where: { userId: user.id, isRead: false },
      data: { isRead: true },
    });
    return Response.json({ success: true });
  } catch (e) {
    return apiError(e);
  }
}
