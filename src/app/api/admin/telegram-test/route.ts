import { requireAdmin, apiError, ApiError } from '@/lib/guard';
import { getPrimaryBot, sendTelegramRaw, validateToken } from '@/lib/telegram';

export const dynamic = 'force-dynamic';

/**
 * ★ টেস্ট মেসেজ — পুরনো পথ, পিছনের-সামঞ্জস্যের জন্য রাখা।
 *
 *   নতুন কোড `/api/admin/telegram/manage` (action: 'test') ব্যবহার করে,
 *   যেটি ডেলিভারি সময়/latency/attempts-ও ফেরত দেয়। এই রুটটি রাখা
 *   হয়েছে কারণ পুরনো UI ও টেস্ট স্ক্রিপ্ট এখনো এটিকে ডাকে; একই
 *   কনফিগ ও একই পাঠানোর পথ ব্যবহার করে, তাই আচরণে পার্থক্য নেই।
 *
 *   ⚠️ টোকেন বডিতে নেয় না, রেসপন্সেও দেয় না। সুইচ উপেক্ষা করে —
 *   অ্যাডমিন সুইচ চালু করার আগেই সংযোগ পরীক্ষা করতে পারে।
 */
export async function POST() {
  try {
    await requireAdmin();

    const bot = await getPrimaryBot();
    if (!bot?.token) {
      throw new ApiError('বট টোকেন সেট করা নেই — Connection Wizard চালান।', 400);
    }
    if (!bot.chatId) {
      throw new ApiError('Chat ID সেট করা নেই — Connection Wizard চালান।', 400);
    }

    const who = await validateToken(bot.token);
    if (!who.ok) {
      throw new ApiError(
        who.unreachable
          ? `টেলিগ্রামে পৌঁছানো যায়নি: ${who.error || 'অজানা'}`
          : `টোকেন যাচাই ব্যর্থ: ${who.error || 'অজানা'}`,
        400,
      );
    }

    const r = await sendTelegramRaw(
      bot.token,
      bot.chatId,
      '✅ SS UID TOPUP Telegram Integration সফলভাবে সংযুক্ত হয়েছে।',
    );
    if (!r.ok) throw new ApiError(`টেলিগ্রাম ত্রুটি: ${r.error || 'পাঠানো যায়নি'}`, 400);

    return Response.json({
      success: true,
      message: `টেস্ট মেসেজ পাঠানো হয়েছে — টেলিগ্রাম দেখুন। (বট: @${who.identity?.username ?? ''})`,
      bot: { username: who.identity?.username ?? null, name: who.identity?.name ?? null },
      responseMs: r.latencyMs,
    });
  } catch (e) {
    return apiError(e);
  }
}

/** সংযোগের অবস্থা — টোকেন ফাঁস না করে */
export async function GET() {
  try {
    await requireAdmin();
    const bot = await getPrimaryBot();
    if (!bot?.token) {
      return Response.json({ configured: false, tokenSource: bot?.source ?? null, reason: 'টোকেন নেই' });
    }
    const who = await validateToken(bot.token);
    return Response.json({
      configured: Boolean(bot.token && bot.chatId),
      tokenValid: who.ok,
      bot: who.ok ? { username: who.identity?.username, name: who.identity?.name } : null,
      chatIdSet: Boolean(bot.chatId),
      tokenSource: bot.source,
      chatIdSource: bot.source,
      ...(who.ok ? {} : { reason: who.error }),
    });
  } catch (e) {
    return apiError(e);
  }
}
