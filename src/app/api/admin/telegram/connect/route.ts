import { requireAdmin, apiError, ApiError, readJson } from '@/lib/guard';
import { adminLog } from '@/lib/adminLog';
import { getIp } from '@/lib/rateLimit';
import {
  upsertBot, getPrimaryBot, getMe, getBotPhotoDataUri,
  BOT_ROLES, ROLE_LABEL, type BotRole,
} from '@/lib/telegram';
import { isSecretBoxReady } from '@/lib/secretbox';

export const dynamic = 'force-dynamic';

/**
 * ★★★ কনফিগ সংরক্ষণ — উইজার্ডের শেষ ধাপ ও ড্যাশবোর্ডের "সম্পাদনা"।
 *
 *   টোকেন এখানে **এনক্রিপ্ট হয়ে** ডাটাবেসে যায় (`store.upsertBot`)।
 *   এরপর থেকে `.env` আর লাগে না — EXE বিতরণের মূল দাবি এটাই।
 *
 *   ⚠️ রেসপন্সে কখনো টোকেন ফেরত যায় না।
 */
export async function POST(req: Request) {
  try {
    const admin = await requireAdmin();

    if (!isSecretBoxReady()) {
      throw new ApiError(
        'এনক্রিপশন কী নেই — সার্ভারে NEXTAUTH_SECRET সেট করুন, নাহলে টোকেন নিরাপদে সংরক্ষণ করা যাবে না।',
        500,
      );
    }

    const body = await readJson<{
      id?: string; role?: string; label?: string;
      token?: string; chatId?: string;
    }>(req);

    const role = (BOT_ROLES as readonly string[]).includes(String(body.role))
      ? (body.role as BotRole)
      : 'admin';

    const existing = body.id ? null : await getPrimaryBot();
    const id = body.id || (existing?.source === 'db' ? existing.id : undefined);

    // ── টোকেন দেওয়া হলে সেভের আগে যাচাই ──
    //    কারণ: অবৈধ টোকেন সেভ করা মানে নীরবে ভাঙা কনফিগ। যাচাই করে
    //    নিলে পরিচয় (username/id/ছবি) একই সাথে ক্যাশ করা যায়, আর
    //    ড্যাশবোর্ডকে প্রতিবার getMe ডাকতে হয় না।
    let identity: { id: number; username: string; name: string } | null = null;
    let photoUrl: string | null | undefined;

    const token = typeof body.token === 'string' ? body.token.trim() : undefined;
    if (token) {
      const r = await getMe(token);
      if (!r.ok || !r.result) {
        throw new ApiError(
          r.unreachable
            ? `টেলিগ্রামে পৌঁছানো যায়নি — ${r.description || 'অজানা'}`
            : `টোকেন গ্রহণযোগ্য নয়: ${r.description || 'অজানা'}`,
          400,
        );
      }
      identity = { id: r.result.id, username: r.result.username, name: r.result.name };
      photoUrl = await getBotPhotoDataUri(token, r.result.id);
    }

    const saved = await upsertBot({
      id,
      role,
      label: body.label || ROLE_LABEL[role],
      ...(token ? { token } : {}),
      ...(body.chatId !== undefined ? { chatId: String(body.chatId).trim() } : {}),
      ...(identity ? { botId: identity.id, username: identity.username, name: identity.name } : {}),
      ...(photoUrl !== undefined ? { photoUrl } : {}),
      enabled: true,
    });

    adminLog({
      adminId: admin.id,
      adminName: admin.name,
      action: 'SETTINGS_CHANGE',
      // ⚠️ কখনোই টোকেনের মান নয় — অডিট লগ DB-তে থাকে ও /admin/logs-এ দেখা যায়
      detail: `টেলিগ্রাম কনফিগ সংরক্ষিত — role=${role}${token ? ', token=<redacted, updated>' : ''}${body.chatId !== undefined ? `, chatId=${String(body.chatId).slice(-4).padStart(6, '•')}` : ''}`,
      ip: getIp(req),
    }).catch(() => {});

    return Response.json({
      success: true,
      bot: {
        id: saved.id,
        role: saved.role,
        label: saved.label,
        username: saved.username,
        name: saved.name,
        botId: saved.botId,
        photoUrl: saved.photoUrl,
        hasToken: Boolean(saved.token),
        hasChatId: Boolean(saved.chatId),
        source: saved.source,
      },
    });
  } catch (e) {
    return apiError(e);
  }
}
