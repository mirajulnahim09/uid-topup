import { requireAdmin, apiError, ApiError, readJson } from '@/lib/guard';
import { adminLog } from '@/lib/adminLog';
import { getIp } from '@/lib/rateLimit';
import {
  getAllBots, toPublic, upsertBot, deleteBot, duplicateBot, reorderBots,
  setBotEnabled, getBotStats, getMe, getBotPhotoDataUri, sendTelegramRaw,
  BOT_ROLES, ROLE_LABEL, ROLE_DEFAULT_EVENTS, TELEGRAM_EVENTS, type BotRole,
} from '@/lib/telegram';
import { isSecretBoxReady } from '@/lib/secretbox';

export const dynamic = 'force-dynamic';

/**
 * ★★★ বহু-বট ব্যবস্থাপনা API
 *
 *   ⚠️ কোনো রেসপন্সে বট টোকেন যায় না — `toPublic()` সবসময় মাস্ক করে।
 *   ⚠️ টোকেন শুধু **ভেতরের দিকে** যায় (অ্যাডমিন টাইপ করে), কখনো বাইরে নয়।
 */

export async function GET() {
  try {
    await requireAdmin();
    const bots = await getAllBots();
    const stats = await getBotStats(bots.map((b) => b.id));
    return Response.json({
      bots: bots.map((b) => ({ ...toPublic(b), stats: stats[b.id] ?? null })),
      roles: BOT_ROLES.map((r) => ({
        id: r, label: ROLE_LABEL[r], defaultEvents: ROLE_DEFAULT_EVENTS[r],
      })),
      events: TELEGRAM_EVENTS.map((e) => ({ key: e.key, label: e.label, group: e.group })),
      encryptionReady: isSecretBoxReady(),
    });
  } catch (e) {
    return apiError(e);
  }
}

export async function POST(req: Request) {
  try {
    const admin = await requireAdmin();
    if (!isSecretBoxReady()) {
      throw new ApiError('এনক্রিপশন কী নেই — NEXTAUTH_SECRET সেট করুন।', 500);
    }

    const body = await readJson<{
      action?: string; id?: string; role?: string; label?: string;
      description?: string; token?: string; chatId?: string;
      enabled?: boolean; priority?: number; events?: string[]; order?: string[];
    }>(req);

    const log = (d: string) => adminLog({
      adminId: admin.id, adminName: admin.name, action: 'SETTINGS_CHANGE',
      detail: `টেলিগ্রাম বট — ${d}`, ip: getIp(req),
    }).catch(() => {});

    switch (body.action) {
      // ── তৈরি / সম্পাদনা ──
      case 'save': {
        const role = (BOT_ROLES as readonly string[]).includes(String(body.role))
          ? (body.role as BotRole) : 'admin';

        // টোকেন দিলে সেভের আগে যাচাই — অবৈধ টোকেন সেভ করা মানে নীরবে ভাঙা কনফিগ
        let identity: { id: number; username: string; name: string } | null = null;
        let photoUrl: string | null | undefined;
        const token = typeof body.token === 'string' && body.token.trim() ? body.token.trim() : undefined;
        if (token) {
          const me = await getMe(token);
          if (!me.ok || !me.result) {
            throw new ApiError(
              me.unreachable
                ? `টেলিগ্রামে পৌঁছানো যায়নি — ${me.description ?? 'অজানা'}`
                : `টোকেন গ্রহণযোগ্য নয়: ${me.description ?? 'অজানা'}`, 400);
          }
          identity = { id: me.result.id, username: me.result.username, name: me.result.name };
          photoUrl = await getBotPhotoDataUri(token, me.result.id);
        }

        // ইভেন্ট allowlist — ফাইল/ক্লায়েন্ট থেকে যা খুশি ঢোকানো যাবে না
        const valid = new Set<string>(TELEGRAM_EVENTS.map((e) => e.key));
        const events = Array.isArray(body.events)
          ? body.events.filter((e) => valid.has(String(e)))
          : undefined;

        const saved = await upsertBot({
          id: body.id, role,
          label: body.label?.trim() || ROLE_LABEL[role],
          description: body.description ?? null,
          ...(token ? { token } : {}),
          ...(body.chatId !== undefined ? { chatId: String(body.chatId).trim() } : {}),
          ...(body.enabled !== undefined ? { enabled: body.enabled } : {}),
          ...(body.priority !== undefined ? { priority: Number(body.priority) } : {}),
          ...(events !== undefined ? { events } : {}),
          ...(identity ? { botId: identity.id, username: identity.username, name: identity.name } : {}),
          ...(photoUrl !== undefined ? { photoUrl } : {}),
        });
        log(`${body.id ? 'সম্পাদনা' : 'নতুন'} — ${saved.label}${token ? ' (token=<redacted, updated>)' : ''}`);
        return Response.json({ success: true, bot: toPublic(saved) });
      }

      case 'delete': {
        if (!body.id) throw new ApiError('id দরকার', 400);
        await deleteBot(body.id);
        log(`মুছে ফেলা — ${body.id}`);
        return Response.json({ success: true, message: 'বট মুছে ফেলা হয়েছে' });
      }

      case 'duplicate': {
        if (!body.id) throw new ApiError('id দরকার', 400);
        const copy = await duplicateBot(body.id);
        if (!copy) throw new ApiError('বট পাওয়া যায়নি', 404);
        log(`নকল — ${copy.label}`);
        return Response.json({
          success: true, bot: toPublic(copy),
          message: 'নকল তৈরি — নিরাপত্তার কারণে টোকেন কপি হয়নি, নতুন টোকেন দিন।',
        });
      }

      case 'enable':
      case 'disable': {
        if (!body.id) throw new ApiError('id দরকার', 400);
        const on = body.action === 'enable';
        await setBotEnabled(body.id, on);
        log(`${on ? 'সক্রিয়' : 'নিষ্ক্রিয়'} — ${body.id}`);
        return Response.json({ success: true, message: on ? 'সক্রিয় হয়েছে' : 'নিষ্ক্রিয় হয়েছে' });
      }

      case 'test': {
        if (!body.id) throw new ApiError('id দরকার', 400);
        const bot = (await getAllBots()).find((b) => b.id === body.id);
        if (!bot) throw new ApiError('বট পাওয়া যায়নি', 404);
        if (!bot.token) throw new ApiError('এই বটের টোকেন নেই', 400);
        if (!bot.chatId) throw new ApiError('এই বটের Chat ID নেই', 400);
        const r = await sendTelegramRaw(bot.token, bot.chatId,
          `✅ <b>${bot.label}</b>\nটেস্ট বার্তা — সংযোগ ঠিক আছে।`);
        if (!r.ok) throw new ApiError(`পাঠানো যায়নি: ${r.error ?? 'অজানা'}`, 400);
        log(`টেস্ট — ${bot.label}`);
        return Response.json({
          success: true, message: `"${bot.label}" — বার্তা পৌঁছেছে`,
          responseMs: r.latencyMs, attempts: r.attempts,
        });
      }

      case 'reorder': {
        if (!Array.isArray(body.order)) throw new ApiError('order তালিকা দরকার', 400);
        await reorderBots(body.order.map(String));
        log(`অগ্রাধিকার পুনর্বিন্যাস (${body.order.length}টি)`);
        return Response.json({ success: true });
      }

      default:
        throw new ApiError('অজানা কাজ', 400);
    }
  } catch (e) {
    return apiError(e);
  }
}
