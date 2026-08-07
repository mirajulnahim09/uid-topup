import { prisma } from '@/lib/prisma';
import { requireAdmin, apiError, ApiError, readJson } from '@/lib/guard';
import { invalidateSettings } from '@/lib/settings';
import { adminLog } from '@/lib/adminLog';
import { getIp } from '@/lib/rateLimit';
import {
  TELEGRAM_EVENTS, getEventFlags, eventSettingKey, MASTER_KEY,
  getAllBots, toPublic, getStats, getConnectionStatus, hasDbConfig,
} from '@/lib/telegram';
import { isSecretBoxReady } from '@/lib/secretbox';

export const dynamic = 'force-dynamic';

/**
 * ★★★ টেলিগ্রাম ড্যাশবোর্ড API
 *
 *   GET  — সংযোগ, বট তালিকা (টোকেনহীন), পরিসংখ্যান, ইভেন্ট সুইচ
 *   POST — মাস্টার ও ইভেন্ট সুইচ সংরক্ষণ
 *
 *   ⚠️ কোনো রেসপন্সে বট টোকেন যায় না — শুধু মাস্কড রূপ।
 */
export async function GET() {
  try {
    await requireAdmin();

    const [conn, bots, stats, flags, dbConfigured] = await Promise.all([
      getConnectionStatus(),
      getAllBots(),
      getStats(),
      getEventFlags(),
      hasDbConfig(),
    ]);

    return Response.json({
      connection: {
        ...conn,
        // পরিচয় ক্যাশ থেকেও দেখানো যায় — নেটওয়ার্ক পড়ে গেলে UI ফাঁকা হবে না
        botName: conn.identity?.name ?? bots[0]?.name ?? null,
        botUsername: conn.identity?.username ?? bots[0]?.username ?? null,
        botId: conn.identity?.id ?? bots[0]?.botId ?? null,
        photoUrl: bots[0]?.photoUrl ?? null,
      },
      bots: bots.map(toPublic),
      stats,
      enabled: flags.enabled,
      events: TELEGRAM_EVENTS.map((e) => ({
        key: e.key, group: e.group, label: e.label,
        hint: e.hint, wired: e.wired, enabled: flags.events[e.key],
      })),
      storage: {
        // ★ EXE-বিতরণের মূল প্রশ্ন: কনফিগ কি .env ছাড়া চলছে?
        dbConfigured,
        encryptionReady: isSecretBoxReady(),
        source: conn.source,
      },
    });
  } catch (e) {
    return apiError(e);
  }
}

export async function POST(req: Request) {
  try {
    const admin = await requireAdmin();
    const body = await readJson<{ enabled?: unknown; events?: Record<string, unknown> }>(req);

    const rows: { key: string; value: string }[] = [];

    if (body.enabled !== undefined) {
      rows.push({ key: MASTER_KEY, value: body.enabled ? '1' : '0' });
    }

    if (body.events && typeof body.events === 'object') {
      // ★ allowlist — অজানা কী DB-তে ঢোকানো যাবে না
      const valid = new Set<string>(TELEGRAM_EVENTS.map((e) => e.key));
      for (const [k, v] of Object.entries(body.events)) {
        if (!valid.has(k)) continue;
        rows.push({ key: eventSettingKey(k), value: v ? '1' : '0' });
      }
    }

    if (rows.length === 0) throw new ApiError('কিছুই বদলায়নি', 400);

    await prisma.$transaction(
      rows.map((r) =>
        prisma.setting.upsert({
          where: { key: r.key }, update: { value: r.value }, create: { key: r.key, value: r.value },
        }),
      ),
    );

    adminLog({
      adminId: admin.id, adminName: admin.name, action: 'SETTINGS_CHANGE',
      detail: `টেলিগ্রাম — ${rows.map((r) => `${r.key}=${r.value}`).join(', ')}`,
      ip: getIp(req),
    }).catch(() => {});

    // ★ সুইচ পাঠানোর পথে ক্যাশ থেকে পড়া হয় — সাথে সাথে কার্যকর করতে
    //   ক্যাশ বাতিল (পরিসংখ্যান লেখার সময় নয়, দেখুন stats.ts)।
    invalidateSettings();

    return Response.json({ success: true, updated: rows.length });
  } catch (e) {
    return apiError(e);
  }
}
