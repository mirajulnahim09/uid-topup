import { getSettings } from '../settings';
import { logger } from '../logger';
import { getBotForRole, getPrimaryBot, type BotRole } from './store';
import { shouldSend, type TelegramEvent } from './events';
import { recordSend, recordConnectionCheck } from './stats';
import { getMe, getChat, sendMessage, scrub, esc, type ApiCall, type BotIdentity } from './api';
import { sendToEvent } from './dispatch';

/**
 * ═══════════════════════════════════════════════════════════
 * ★ টেলিগ্রাম — পাবলিক API (ব্যবসায়িক কোড এটিই ব্যবহার করে)
 *
 *   কনফিগ অগ্রাধিকার: **ডাটাবেস (এনক্রিপ্টেড) → .env**
 *   বিস্তারিত `store.ts`-এ।
 *
 *   ⚠️ কোনো ফাংশন throw করে না — টেলিগ্রাম ব্যর্থ হলেও মূল ফ্লো
 *   ও ইন-অ্যাপ নোটিফিকেশন অক্ষত থাকে।
 *   ⚠️ টোকেন কখনো লগ/রেসপন্স/ব্রাউজারে যায় না।
 * ═══════════════════════════════════════════════════════════
 */

export * from './store';
export * from './events';
export * from './stats';
export * from './log';
export * from './templates';
export * from './dispatch';
export { scrub, esc, getMe, getChat, sendMessage, getBotPhotoDataUri, TELEGRAM_TIMEOUT_MS } from './api';
export type { ApiCall, BotIdentity, ChatInfo } from './api';

/** টোকেন যাচাই + সংযোগ-পরীক্ষা রেকর্ড */
export async function validateToken(token: string): Promise<{
  ok: boolean;
  identity?: BotIdentity;
  error?: string;
  unreachable: boolean;
  latencyMs: number;
}> {
  if (!token) {
    return { ok: false, error: 'টোকেন নেই', unreachable: false, latencyMs: 0 };
  }
  const r = await getMe(token);
  await recordConnectionCheck({
    ok: r.ok,
    latencyMs: r.latencyMs,
    apiResponse: r.ok ? 'OK (getMe)' : r.description || `HTTP ${r.status}`,
  });
  return {
    ok: r.ok,
    identity: r.result,
    error: r.ok ? undefined : r.description || `HTTP ${r.status}`,
    // ★ "পৌঁছানো যায়নি" ≠ "টোকেন ভুল"। টাইমআউটে অ্যাডমিনকে ঠিক থাকা
    //   টোকেন বদলাতে পাঠানো সবচেয়ে খারাপ পরামর্শ।
    unreachable: r.unreachable,
    latencyMs: r.latencyMs,
  };
}

/**
 * সরাসরি টোকেন+chat_id দিয়ে পাঠায় — সুইচ **উপেক্ষা** করে।
 * উইজার্ড ও "টেস্ট মেসেজ" এটিই ব্যবহার করে, কারণ অ্যাডমিন সাধারণত
 * সুইচ চালু করার *আগেই* সংযোগ পরীক্ষা করতে চায়।
 */
export async function sendTelegramRaw(
  token: string,
  chatId: string,
  text: string,
): Promise<{ ok: boolean; error?: string; latencyMs: number; attempts: number; messageId?: number }> {
  if (!token || !chatId) {
    return { ok: false, error: 'টোকেন বা chat_id নেই', latencyMs: 0, attempts: 0 };
  }
  const r = await sendMessage(token, chatId, text);
  await recordSend({
    ok: r.ok,
    latencyMs: r.latencyMs,
    attempts: r.attempts,
    error: r.ok ? undefined : r.description,
    apiResponse: r.ok ? 'OK (sendMessage)' : r.description || `HTTP ${r.status}`,
  });
  return {
    ok: r.ok,
    error: r.ok ? undefined : r.description || `HTTP ${r.status}`,
    latencyMs: r.latencyMs,
    attempts: r.attempts,
    messageId: r.result?.message_id,
  };
}

/** বার্তার শরীর গঠন — সাইটের নাম ও লিংক সহ */
async function compose(title: string, body: string, link?: string): Promise<string> {
  const s = await getSettings().catch(() => ({}) as Record<string, string>);
  const base = (s.site_name || 'SS UID TOPUP').trim();
  let text = `🔔 <b>${esc(title)}</b>\n${esc(body)}`;
  if (link) {
    const origin = (s.site_url || '').replace(/\/$/, '');
    const full = origin && link.startsWith('/') ? `${origin}${link}` : link;
    text += `\n\n🔗 ${esc(full)}`;
  }
  return `${text}\n<i>${esc(base)}</i>`;
}

/**
 * অ্যাডমিন-নোটিফিকেশন — কনফিগ ও সুইচ নিজে দেখে নেয়।
 * সেট না থাকলে বা সুইচ বন্ধ থাকলে চুপচাপ ফিরে যায়।
 */
export async function sendTelegramAdmin(
  title: string,
  body: string,
  link?: string,
  event?: TelegramEvent,
  role: BotRole = 'admin',
): Promise<void> {
  try {
    // ★★★ ২০২৬-০৮-০৫ (এন্টারপ্রাইজ): শ্রেণিভুক্ত ইভেন্ট এখন
    //   `sendToEvent()` দিয়ে **যোগ্য সব বটে** যায় (fan-out), শুধু
    //   admin বটে নয়। কল-সাইট একটিও বদলায়নি — রাউটিং-এর সিদ্ধান্ত
    //   `dispatch.ts`-এ সরানো হয়েছে, যাতে যুক্তি দুই জায়গায় না থাকে।
    if (event) {
      await sendToEvent(event, title, esc(body), link);
      return;
    }

    // শ্রেণিভুক্ত নয় এমন বার্তা — আগের মতোই একটিমাত্র বটে
    const bot = await getBotForRole(role);
    if (!bot || !bot.token || !bot.chatId) return; // কনফিগ নেই — নীরব
    if (!(await shouldSend(event))) return;

    const text = await compose(title, body, link);
    const r = await sendTelegramRaw(bot.token, bot.chatId, text);
    if (!r.ok) {
      logger.warn('telegram', 'সতর্কতা পাঠানো যায়নি', { error: r.error });
    }
  } catch (e) {
    const msg = scrub(e instanceof Error ? e.message : 'unknown');
    logger.error('telegram', 'sendTelegramAdmin failed', { error: msg });
    await recordSend({ ok: false, error: msg }).catch(() => {});
  }
}

/**
 * ★ শুধু টেলিগ্রাম — ইন-অ্যাপ নোটিফিকেশন **নয়**।
 *
 *   ব্যবহার: অ্যাডমিন নিজে যে কাজগুলো করে (অনুমোদন, রিফান্ড,
 *   প্রকাশ)। `notifyAdmins` ডাকলে অ্যাডমিন **নিজের কাজের** ইন-অ্যাপ
 *   নোটিফিকেশন পেত — অর্থহীন কোলাহল; কিন্তু অপারেটর-গ্রুপে এগুলো
 *   কাজে লাগে।
 */
export async function telegramEvent(
  event: TelegramEvent,
  title: string,
  body: string,
  link?: string,
): Promise<void> {
  await sendTelegramAdmin(title, body, link, event).catch(() => {});
}

/** সংযোগের সারসংক্ষেপ — API ও পাতা দুটোই এটি ব্যবহার করে */
export async function getConnectionStatus(): Promise<{
  configured: boolean;
  connected: boolean;
  tokenValid: boolean;
  unreachable: boolean;
  hasToken: boolean;
  hasChatId: boolean;
  identity: BotIdentity | null;
  error: string | null;
  latencyMs: number;
  source: 'db' | 'env' | null;
}> {
  const bot = await getPrimaryBot();
  if (!bot || !bot.token) {
    return {
      configured: false, connected: false, tokenValid: false, unreachable: false,
      hasToken: false, hasChatId: Boolean(bot?.chatId), identity: null,
      error: null, latencyMs: 0, source: bot?.source ?? null,
    };
  }
  const v = await validateToken(bot.token);
  return {
    configured: Boolean(bot.token && bot.chatId),
    connected: Boolean(v.ok && bot.chatId),
    tokenValid: v.ok,
    unreachable: v.unreachable,
    hasToken: true,
    hasChatId: Boolean(bot.chatId),
    identity: v.identity ?? null,
    error: v.error ?? null,
    latencyMs: v.latencyMs,
    source: bot.source,
  };
}

export type { TelegramEvent, BotRole };
export type { ApiCall as TelegramApiCall };
