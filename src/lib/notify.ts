import { prisma } from './prisma';

/** In-app notification — কখনো throw করে না, main flow ভাঙবে না */
export async function notify(
  userId: string,
  title: string,
  body: string,
  link?: string
): Promise<void> {
  try {
    await prisma.notification.create({ data: { userId, title, body, link } });
  } catch (e) {
    console.error('[notify] failed:', e);
  }
}

/**
 * ★ সব অ্যাডমিনকে একসাথে নোটিফিকেশন (নতুন অর্ডার/রিচার্জ/রেজিস্ট্রেশন)।
 *   কখনো throw করে না — main flow ভাঙবে না।
 */
export async function notifyAdmins(title: string, body: string, link?: string): Promise<void> {
  try {
    const admins = await prisma.user.findMany({ where: { role: 'ADMIN' }, select: { id: true } });
    if (admins.length === 0) return;
    await prisma.notification.createMany({
      data: admins.map((a: { id: string }) => ({ userId: a.id, title, body, link })),
    });
  } catch (e) {
    console.error('[notifyAdmins] failed:', e);
  }
}
