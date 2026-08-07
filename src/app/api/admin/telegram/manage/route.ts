import { requireAdmin, apiError, ApiError, readJson } from '@/lib/guard';
import { adminLog } from '@/lib/adminLog';
import { getIp } from '@/lib/rateLimit';
import { prisma } from '@/lib/prisma';
import { invalidateSettings } from '@/lib/settings';
import {
  getPrimaryBot, sendTelegramRaw, validateToken,
  resetAllBots, setBotEnabled, upsertBot, resetStats,
  adoptEnvConfig, MASTER_KEY,
} from '@/lib/telegram';

export const dynamic = 'force-dynamic';

const TEST_TEXT = '✅ SS UID TOPUP Telegram Integration সফলভাবে সংযুক্ত হয়েছে।';

/**
 * ★★★ ব্যবস্থাপনা কাজ — টেস্ট, পুনঃসংযোগ, বিচ্ছিন্ন, রিসেট, চালু/বন্ধ।
 *
 *   প্রতিটি কাজ **স্বতন্ত্র ও বিপরীতমুখী**, কেবল `reset` ছাড়া —
 *   সেটি সব কনফিগ মুছে দেয়, তাই UI-তে নিশ্চিতকরণ চাওয়া হয়।
 */
export async function POST(req: Request) {
  try {
    const admin = await requireAdmin();
    const { action } = await readJson<{ action?: string }>(req);

    const log = (detail: string) =>
      adminLog({
        adminId: admin.id, adminName: admin.name,
        action: 'SETTINGS_CHANGE', detail: `টেলিগ্রাম — ${detail}`, ip: getIp(req),
      }).catch(() => {});

    switch (action) {
      // ───────── টেস্ট মেসেজ ─────────
      case 'test': {
        const bot = await getPrimaryBot();
        if (!bot?.token) throw new ApiError('বট টোকেন সেট করা নেই', 400);
        if (!bot.chatId) throw new ApiError('Chat ID সেট করা নেই', 400);

        const started = Date.now();
        const r = await sendTelegramRaw(bot.token, bot.chatId, TEST_TEXT);
        const wall = Date.now() - started;

        if (!r.ok) {
          throw new ApiError(`পাঠানো যায়নি: ${r.error || 'অজানা'}`, 400);
        }
        log('টেস্ট মেসেজ পাঠানো হয়েছে');
        return Response.json({
          success: true,
          message: 'টেস্ট মেসেজ সফলভাবে পৌঁছেছে',
          deliveredAt: new Date().toISOString(),
          responseMs: r.latencyMs,
          totalMs: wall,
          attempts: r.attempts,
          messageId: r.messageId ?? null,
          apiStatus: 'OK',
        });
      }

      // ───────── পুনঃসংযোগ (টোকেন আবার যাচাই) ─────────
      case 'reconnect': {
        const bot = await getPrimaryBot();
        if (!bot?.token) throw new ApiError('বট টোকেন সেট করা নেই', 400);
        const v = await validateToken(bot.token);
        if (!v.ok) {
          throw new ApiError(
            v.unreachable
              ? `টেলিগ্রামে পৌঁছানো যায়নি: ${v.error}`
              : `টোকেন প্রত্যাখ্যাত: ${v.error}`,
            400,
          );
        }
        // ★ পরিচয় নতুন করে ক্যাশ করি — বট নাম/username বদলে থাকতে পারে
        if (bot.source === 'db' && v.identity) {
          await upsertBot({
            id: bot.id,
            botId: v.identity.id,
            username: v.identity.username,
            name: v.identity.name,
          });
        }
        log('পুনঃসংযোগ সফল');
        return Response.json({
          success: true,
          message: `পুনঃসংযোগ সফল — @${v.identity?.username ?? ''}`,
          latencyMs: v.latencyMs,
        });
      }

      // ───────── বিচ্ছিন্ন (কনফিগ থাকে, পাঠানো বন্ধ) ─────────
      case 'disconnect': {
        const bot = await getPrimaryBot();
        if (bot?.source === 'db') await setBotEnabled(bot.id, false);
        await prisma.setting.upsert({
          where: { key: MASTER_KEY }, update: { value: '0' }, create: { key: MASTER_KEY, value: '0' },
        });
        invalidateSettings();
        log('বিচ্ছিন্ন করা হয়েছে');
        return Response.json({ success: true, message: 'বিচ্ছিন্ন — কনফিগ মুছে যায়নি, শুধু পাঠানো বন্ধ' });
      }

      case 'enable':
      case 'disable': {
        const on = action === 'enable';
        const bot = await getPrimaryBot();
        if (bot?.source === 'db') await setBotEnabled(bot.id, on);
        await prisma.setting.upsert({
          where: { key: MASTER_KEY },
          update: { value: on ? '1' : '0' },
          create: { key: MASTER_KEY, value: on ? '1' : '0' },
        });
        invalidateSettings();
        log(on ? 'চালু করা হয়েছে' : 'বন্ধ করা হয়েছে');
        return Response.json({ success: true, message: on ? 'চালু হয়েছে' : 'বন্ধ হয়েছে' });
      }

      // ───────── .env → এনক্রিপ্টেড DB ─────────
      //   EXE বিতরণের মূল ধাপ: প্রথম ইনস্টলে `.env`-এ টোকেন থাকলে
      //   এক ক্লিকে সেটি এনক্রিপ্ট হয়ে DB-তে চলে আসে, এরপর আর
      //   কোনো ফাইল সম্পাদনার দরকার নেই।
      case 'adopt-env': {
        const adopted = await adoptEnvConfig();
        if (!adopted) {
          throw new ApiError(
            'নেওয়ার মতো কিছু নেই — হয় ডাটাবেসে ইতিমধ্যেই কনফিগ আছে, নয়তো .env ফাঁকা।',
            400,
          );
        }
        log('.env কনফিগ এনক্রিপ্ট করে ডাটাবেসে নেওয়া হয়েছে');
        return Response.json({
          success: true,
          message: 'কনফিগ এনক্রিপ্ট হয়ে ডাটাবেসে সংরক্ষিত — এখন থেকে .env ছাড়াই চলবে।',
        });
      }

      // ───────── সম্পূর্ণ রিসেট ─────────
      case 'reset': {
        await resetAllBots();
        await resetStats();
        // ইভেন্ট-সুইচগুলোও ডিফল্টে ফিরুক
        await prisma.setting.deleteMany({
          where: { OR: [{ key: { startsWith: 'telegram_ev_' } }, { key: MASTER_KEY }] },
        });
        invalidateSettings();
        log('সম্পূর্ণ রিসেট');
        return Response.json({
          success: true,
          message: 'সব টেলিগ্রাম কনফিগ ও পরিসংখ্যান মুছে ফেলা হয়েছে',
        });
      }

      default:
        throw new ApiError('অজানা কাজ', 400);
    }
  } catch (e) {
    return apiError(e);
  }
}
