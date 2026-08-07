import { prisma } from '@/lib/prisma';
import { requireAdmin, apiError, ApiError, readJson } from '@/lib/guard';
import { cleanText } from '@/lib/sanitize';
import { adminLog } from '@/lib/adminLog';
import { getIp } from '@/lib/rateLimit';

/**
 * ★ Announcement — সব ইউজারকে একসাথে একটি নোটিফিকেশন পাঠায়।
 *   অ্যাডমিন প্যানেল → টুলস থেকে।
 */
export async function POST(req: Request) {
  try {
    const admin = await requireAdmin();

    const raw = await readJson(req);
    const title = cleanText(raw?.title ?? '', 100);
    const body = cleanText(raw?.body ?? '', 500);
    const link = raw?.link ? cleanText(raw.link, 200) : undefined;

    if (!title.trim()) throw new ApiError('শিরোনাম লিখুন', 400);
    if (!body.trim()) throw new ApiError('বার্তা লিখুন', 400);

    // ★ সব ইউজারের id (ব্যাচে করা নিরাপদ)
    const users = await prisma.user.findMany({ select: { id: true } });
    if (users.length === 0) throw new ApiError('কোনো ইউজার নেই', 400);

    await prisma.notification.createMany({
      data: users.map((u: { id: string }) => ({
        userId: u.id,
        title: `📢 ${title}`,
        body,
        link,
      })),
    });

    adminLog({
      adminId: admin.id,
      adminName: admin.name,
      action: 'SETTINGS_CHANGE',
      detail: `ঘোষণা পাঠানো হয়েছে (${users.length} জন): ${title}`,
      ip: getIp(req),
    }).catch(() => {});

    return Response.json({ success: true, count: users.length });
  } catch (e) {
    return apiError(e);
  }
}
