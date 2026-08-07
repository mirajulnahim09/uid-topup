import { getSettings } from '../settings';
import { logger } from '../logger';
import { getBotsForEvent } from './store';
import { shouldSend } from './events';
import { sendMessage, esc, scrub } from './api';
import { logMessage } from './log';
import { recordSend } from './stats';

/**
 * ═══════════════════════════════════════════════════════════
 * ★★★ বহু-বট প্রেরণ (fan-out)
 *
 *   একটি ইভেন্ট একাধিক বটে যেতে পারে (যেমন `refund` → অ্যাডমিন বট
 *   **ও** মনিটরিং বট)। এই ফাইলই একমাত্র জায়গা যেখানে সেই সিদ্ধান্ত
 *   হয় — বাকি সব কোড শুধু "এই ইভেন্টটি ঘটেছে" বলে।
 *
 *   নিয়ম:
 *   • ইভেন্ট-সুইচ বন্ধ থাকলে **কোনো** বটেই যাবে না
 *   • প্রতিটি বটে আলাদা করে পাঠানো ও আলাদা করে লগ করা হয়
 *   • একটি বট ব্যর্থ হলে বাকিগুলো তবু চেষ্টা করে — একটি ভুল chat_id
 *     পুরো ফ্যান-আউট থামাতে পারবে না
 *   • কখনো throw করে না
 * ═══════════════════════════════════════════════════════════
 */

export type DispatchResult = {
  ok: boolean;
  delivered: number;
  attempted: number;
  error?: string;
};

async function compose(title: string, body: string, link?: string): Promise<string> {
  const s = await getSettings().catch(() => ({}) as Record<string, string>);
  const base = (s.site_name || 'SS UID TOPUP').trim();
  let text = `🔔 <b>${esc(title)}</b>\n${body}`;
  if (link) {
    const origin = (s.site_url || '').replace(/\/$/, '');
    const full = origin && link.startsWith('/') ? `${origin}${link}` : link;
    text += `\n\n🔗 ${esc(full)}`;
  }
  return `${text}\n<i>${esc(base)}</i>`;
}

/**
 * একটি ইভেন্টের বার্তা যোগ্য সব বটে পাঠায়।
 *
 * ⚠️ `body` **এসকেপ করা হয় না** — কল-সাইট হয় সাধারণ টেক্সট দেয়
 *    (নিরাপদ), নয়তো টেমপ্লেট-রেন্ডার করা HTML দেয় যেখানে চলকগুলো
 *    ইতিমধ্যেই `esc()` হয়ে গেছে (templates.ts দেখুন)।
 */
export async function sendToEvent(
  event: string,
  title: string,
  body: string,
  link?: string,
): Promise<DispatchResult> {
  try {
    if (!(await shouldSend(event as never))) {
      return { ok: true, delivered: 0, attempted: 0 };
    }

    const bots = await getBotsForEvent(event);
    if (bots.length === 0) return { ok: true, delivered: 0, attempted: 0 };

    const text = await compose(title, body, link);
    const bytes = Buffer.byteLength(text, 'utf8');

    let delivered = 0;
    let lastError: string | undefined;

    for (const bot of bots) {
      const r = await sendMessage(bot.token, bot.chatId, text);
      if (r.ok) delivered++;
      else lastError = r.description || `HTTP ${r.status}`;

      await logMessage({
        botId: bot.id,
        event,
        ok: r.ok,
        status: r.status,
        latencyMs: r.latencyMs,
        attempts: r.attempts,
        bytes,
        error: r.ok ? null : lastError,
        response: r.ok ? 'OK (sendMessage)' : lastError,
        trigger: 'EVENT',
      });

      // পুরনো সারসংক্ষেপ কাউন্টারও চালু থাকুক (ড্যাশবোর্ডের উপরের অংশ)
      await recordSend({
        ok: r.ok, event, latencyMs: r.latencyMs, attempts: r.attempts,
        error: r.ok ? undefined : lastError,
        apiResponse: r.ok ? 'OK (sendMessage)' : lastError,
      });
    }

    if (delivered === 0 && lastError) {
      logger.warn('telegram', 'কোনো বটে পাঠানো যায়নি', { event, error: lastError });
    }

    return {
      ok: delivered > 0,
      delivered,
      attempted: bots.length,
      error: delivered === 0 ? lastError : undefined,
    };
  } catch (e) {
    const msg = scrub(e instanceof Error ? e.message : String(e));
    logger.error('telegram', 'dispatch failed', { error: msg });
    return { ok: false, delivered: 0, attempted: 0, error: msg };
  }
}
