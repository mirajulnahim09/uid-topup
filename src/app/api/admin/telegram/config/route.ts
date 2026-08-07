import { requireAdmin, apiError, ApiError, readJson } from '@/lib/guard';
import { adminLog } from '@/lib/adminLog';
import { getIp } from '@/lib/rateLimit';
import { prisma } from '@/lib/prisma';
import { invalidateSettings } from '@/lib/settings';
import {
  getAllBots, upsertBot, getEventFlags, TELEGRAM_EVENTS,
  eventSettingKey, MASTER_KEY, BOT_ROLES, type BotRole,
} from '@/lib/telegram';

export const dynamic = 'force-dynamic';

const FORMAT = 'uidtopup.telegram.config';
const VERSION = 1;

/**
 * ★★★ কনফিগ এক্সপোর্ট / ইমপোর্ট
 *
 *   ── কেন এক্সপোর্টে টোকেন **থাকে না** ──
 *   টোকেন DB-তে এই ইনস্টলেশনের কী দিয়ে এনক্রিপ্ট করা। সেই ciphertext
 *   রপ্তানি করলে অন্য মেশিনে **কাজ করবে না** (কী আলাদা), আর প্লেইনটেক্সট
 *   রপ্তানি করলে ফাইলটিই একটি ফাঁস — ইমেইলে/ড্রাইভে/চ্যাটে চলে যায়,
 *   যেখানে আমাদের এনক্রিপশনের কোনো নিয়ন্ত্রণ নেই।
 *
 *   তাই এক্সপোর্টে থাকে **কাঠামো ও পছন্দ** (ইভেন্ট সুইচ, role, label,
 *   chat_id) — নতুন ইনস্টলেশনে ইমপোর্ট করলে শুধু টোকেনটুকু বসাতে হয়।
 *   এটি একটি সচেতন সীমা, ভুলে যাওয়া নয়; UI-তেও স্পষ্ট বলা আছে।
 */

export async function GET(req: Request) {
  try {
    const admin = await requireAdmin();
    const [bots, flags] = await Promise.all([getAllBots(), getEventFlags()]);

    const payload = {
      format: FORMAT,
      version: VERSION,
      exportedAt: new Date().toISOString(),
      note: 'বট টোকেন ইচ্ছাকৃতভাবে বাদ দেওয়া হয়েছে — ইমপোর্টের পর টোকেন আবার বসাতে হবে।',
      enabled: flags.enabled,
      events: Object.fromEntries(TELEGRAM_EVENTS.map((e) => [e.key, flags.events[e.key]])),
      bots: bots.map((b) => ({
        role: b.role,
        label: b.label,
        chatId: b.chatId,
        enabled: b.enabled,
        username: b.username,
        // token: ইচ্ছাকৃতভাবে অনুপস্থিত (উপরের ব্যাখ্যা)
        hasToken: Boolean(b.token),
      })),
    };

    adminLog({
      adminId: admin.id, adminName: admin.name, action: 'SETTINGS_CHANGE',
      detail: 'টেলিগ্রাম কনফিগ এক্সপোর্ট', ip: getIp(req),
    }).catch(() => {});

    return new Response(JSON.stringify(payload, null, 2), {
      headers: {
        'Content-Type': 'application/json',
        'Content-Disposition': `attachment; filename="telegram-config-${new Date().toISOString().slice(0, 10)}.json"`,
      },
    });
  } catch (e) {
    return apiError(e);
  }
}

export async function POST(req: Request) {
  try {
    const admin = await requireAdmin();
    const body = await readJson<Record<string, unknown>>(req);

    if (body.format !== FORMAT) {
      throw new ApiError('এই ফাইলটি টেলিগ্রাম কনফিগ নয়', 400);
    }
    if (typeof body.version !== 'number' || body.version > VERSION) {
      throw new ApiError('ফাইলের সংস্করণ এই অ্যাপ চেনে না', 400);
    }

    const rows: { key: string; value: string }[] = [];

    if (typeof body.enabled === 'boolean') {
      rows.push({ key: MASTER_KEY, value: body.enabled ? '1' : '0' });
    }

    // ★ allowlist — ফাইল থেকে আসা যেকোনো কী DB-তে ঢোকানো যাবে না
    if (body.events && typeof body.events === 'object') {
      const valid = new Set<string>(TELEGRAM_EVENTS.map((e) => e.key));
      for (const [k, v] of Object.entries(body.events as Record<string, unknown>)) {
        if (!valid.has(k)) continue;
        rows.push({ key: eventSettingKey(k), value: v ? '1' : '0' });
      }
    }

    if (rows.length > 0) {
      await prisma.$transaction(
        rows.map((r) =>
          prisma.setting.upsert({
            where: { key: r.key }, update: { value: r.value }, create: { key: r.key, value: r.value },
          }),
        ),
      );
    }

    // ── বট কাঠামো (টোকেন ছাড়া) ──
    let botsImported = 0;
    if (Array.isArray(body.bots)) {
      for (const raw of body.bots as Record<string, unknown>[]) {
        const role = (BOT_ROLES as readonly string[]).includes(String(raw.role))
          ? (raw.role as BotRole)
          : null;
        if (!role) continue;
        await upsertBot({
          role,
          label: typeof raw.label === 'string' ? raw.label : undefined,
          chatId: typeof raw.chatId === 'string' ? raw.chatId : undefined,
          enabled: raw.enabled !== false,
          username: typeof raw.username === 'string' ? raw.username : undefined,
          // ★ token ইচ্ছাকৃতভাবে সেট করা হয় না — ফাইলে থাকেও না
        });
        botsImported++;
      }
    }

    invalidateSettings();

    adminLog({
      adminId: admin.id, adminName: admin.name, action: 'SETTINGS_CHANGE',
      detail: `টেলিগ্রাম কনফিগ ইমপোর্ট — ${rows.length} সেটিং, ${botsImported} বট`,
      ip: getIp(req),
    }).catch(() => {});

    return Response.json({
      success: true,
      imported: { settings: rows.length, bots: botsImported },
      message: botsImported > 0
        ? 'ইমপোর্ট সম্পন্ন — এখন বট টোকেন বসিয়ে সংযোগ যাচাই করুন।'
        : 'ইমপোর্ট সম্পন্ন।',
    });
  } catch (e) {
    return apiError(e);
  }
}
