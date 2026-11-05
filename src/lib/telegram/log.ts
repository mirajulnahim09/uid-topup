import { prisma } from '../prisma';
import { scrub } from './api';
import { dhakaDayStart } from '../date';

/**
 * ═══════════════════════════════════════════════════════════
 * ★★★ বার্তা-লগ ও বিশ্লেষণ
 *
 *   ── কেন কাউন্টার নয়, প্রতি-বার্তার সারি ──
 *   আগে মোট-পাঠানো/ব্যর্থ ছিল `Setting`-এ কাউন্টার। কিন্তু "গত ৭ দিনের
 *   সাফল্যের হার", "কোন বট কত পাঠিয়েছে", "দৈনিক ব্যবহার" — এগুলো
 *   কাউন্টার থেকে বের করা **অসম্ভব**। প্রতিটি পাঠানোর একটি সারি রাখলে
 *   সব প্রশ্নের উত্তর একই ডেটা থেকে আসে, আর lost-update দৌড়ও থাকে না
 *   (কোনো read-modify-write নেই)।
 *
 *   ⚠️ সারি বাড়তেই থাকবে — তাই `pruneOldLogs()` ৯০ দিনের বেশি পুরনো
 *   সারি মুছে দেয়, rate-limiter-এর মতোই সম্ভাব্যতা-ভিত্তিক (প্রতি কলে নয়)।
 *
 *   ⚠️ এখানে কখনো টোকেন লেখা হয় না — ত্রুটি-বার্তা `scrub()` দিয়ে ছাঁকা।
 * ═══════════════════════════════════════════════════════════
 */

const RETENTION_DAYS = 90;

export type LogInput = {
  botId: string;
  event?: string | null;
  ok: boolean;
  status?: number | null;
  latencyMs?: number;
  attempts?: number;
  bytes?: number;
  error?: string | null;
  response?: string | null;
  trigger?: 'EVENT' | 'TEST' | 'SCHEDULE';
};

export async function logMessage(input: LogInput): Promise<void> {
  try {
    await prisma.telegramMessageLog.create({
      data: {
        botId: input.botId || 'unknown',
        event: input.event ?? null,
        ok: input.ok,
        status: input.status ?? null,
        latencyMs: Math.max(0, Math.round(input.latencyMs ?? 0)),
        attempts: Math.max(1, input.attempts ?? 1),
        bytes: Math.max(0, input.bytes ?? 0),
        error: input.error ? scrub(input.error).slice(0, 300) : null,
        response: input.response ? scrub(input.response).slice(0, 200) : null,
        trigger: input.trigger ?? 'EVENT',
      },
    });
  } catch {
    // লগ লেখা কখনোই নোটিফিকেশন-ফ্লো ভাঙবে না
  }

  // ★ ~2% সম্ভাবনায় পুরনো সারি ছাঁটাই — প্রতি কলে করলে অকারণ খরচ
  if (Math.random() < 0.02) void pruneOldLogs();
}

export async function pruneOldLogs(): Promise<number> {
  try {
    const cutoff = new Date(Date.now() - RETENTION_DAYS * 86400_000);
    const r = await prisma.telegramMessageLog.deleteMany({
      where: { createdAt: { lt: cutoff } },
    });
    return r.count;
  } catch {
    return 0;
  }
}

export type UsageBucket = { sent: number; failed: number; successRate: number };
export type Analytics = {
  today: UsageBucket;
  week: UsageBucket;
  month: UsageBucket;
  allTime: UsageBucket;
  avgLatencyMs: number | null;
  p95LatencyMs: number | null;
  totalRetries: number;
  totalBytes: number;
  /** দৈনিক ভাঙা — চার্ট/স্পার্কলাইনের জন্য (সাম্প্রতিক ১৪ দিন) */
  daily: { date: string; sent: number; failed: number }[];
  perBot: { botId: string; sent: number; failed: number; successRate: number; avgLatencyMs: number }[];
  recent: {
    id: string; botId: string; event: string | null; ok: boolean; status: number | null;
    latencyMs: number; attempts: number; bytes: number; error: string | null;
    response: string | null; trigger: string; createdAt: string;
  }[];
};

const rate = (sent: number, failed: number) => {
  const total = sent + failed;
  return total === 0 ? 100 : Math.round((sent / total) * 1000) / 10;
};

async function bucket(since: Date | null): Promise<UsageBucket> {
  const where = since ? { createdAt: { gte: since } } : {};
  const [sent, failed] = await Promise.all([
    prisma.telegramMessageLog.count({ where: { ...where, ok: true } }),
    prisma.telegramMessageLog.count({ where: { ...where, ok: false } }),
  ]);
  return { sent, failed, successRate: rate(sent, failed) };
}

export async function getAnalytics(): Promise<Analytics> {
  const empty: UsageBucket = { sent: 0, failed: 0, successRate: 100 };
  try {
    const now = Date.now();
    const startOfToday = dhakaDayStart(); // ★ ঢাকার আজ (`lib/date.ts`)
    const week = new Date(now - 7 * 86400_000);
    const month = new Date(now - 30 * 86400_000);

    const [today, w, m, all, agg, retryAgg, recentRows, perBotRows, dailyRows] =
      await Promise.all([
        bucket(startOfToday),
        bucket(week),
        bucket(month),
        bucket(null),
        prisma.telegramMessageLog.aggregate({
          _avg: { latencyMs: true }, _sum: { bytes: true },
          where: { ok: true },
        }),
        prisma.telegramMessageLog.aggregate({ _sum: { attempts: true }, _count: { _all: true } }),
        prisma.telegramMessageLog.findMany({
          orderBy: { createdAt: 'desc' }, take: 40,
        }),
        prisma.telegramMessageLog.groupBy({
          by: ['botId', 'ok'], _count: { _all: true }, _avg: { latencyMs: true },
        }),
        // ★ দৈনিক ভাঙা — SQL-এ গোষ্ঠীবদ্ধ, কারণ ১৪টি আলাদা কোয়েরি অপচয়
        //   ⚠️ `createdAt` UTC-তে রাখা; +৬ ঘণ্টা সরিয়ে কাটলে ঢাকার দিন (DST নেই)
        prisma.$queryRaw<{ day: Date; ok: boolean; n: bigint }[]>`
          SELECT date_trunc('day', "createdAt" + INTERVAL '6 hours') AS day, "ok", COUNT(*) AS n
          FROM "TelegramMessageLog"
          WHERE "createdAt" >= NOW() - INTERVAL '14 days'
          GROUP BY 1, 2 ORDER BY 1
        `,
      ]);

    // p95 — আলাদা কোয়েরি (Prisma-তে percentile নেই)
    let p95: number | null = null;
    try {
      const r = await prisma.$queryRaw<{ p: number | null }[]>`
        SELECT percentile_disc(0.95) WITHIN GROUP (ORDER BY "latencyMs") AS p
        FROM "TelegramMessageLog" WHERE "ok" = true
      `;
      p95 = r[0]?.p != null ? Math.round(Number(r[0].p)) : null;
    } catch { p95 = null; }

    // per-bot মিশিয়ে আনা
    const perBotMap = new Map<string, { sent: number; failed: number; lat: number[] }>();
    for (const row of perBotRows) {
      const e = perBotMap.get(row.botId) ?? { sent: 0, failed: 0, lat: [] };
      if (row.ok) e.sent += row._count._all; else e.failed += row._count._all;
      if (row._avg.latencyMs != null) e.lat.push(row._avg.latencyMs);
      perBotMap.set(row.botId, e);
    }

    // দৈনিক
    const dayMap = new Map<string, { sent: number; failed: number }>();
    for (const r of dailyRows) {
      const key = new Date(r.day).toISOString().slice(0, 10);
      const e = dayMap.get(key) ?? { sent: 0, failed: 0 };
      if (r.ok) e.sent += Number(r.n); else e.failed += Number(r.n);
      dayMap.set(key, e);
    }

    return {
      today, week: w, month: m, allTime: all,
      avgLatencyMs: agg._avg.latencyMs != null ? Math.round(agg._avg.latencyMs) : null,
      p95LatencyMs: p95,
      // মোট চেষ্টা − মোট বার্তা = অতিরিক্ত চেষ্টা (retry)
      totalRetries: Math.max(0, (retryAgg._sum.attempts ?? 0) - (retryAgg._count._all ?? 0)),
      totalBytes: agg._sum.bytes ?? 0,
      daily: [...dayMap.entries()].map(([date, v]) => ({ date, ...v })),
      perBot: [...perBotMap.entries()].map(([botId, v]) => ({
        botId, sent: v.sent, failed: v.failed,
        successRate: rate(v.sent, v.failed),
        avgLatencyMs: v.lat.length ? Math.round(v.lat.reduce((a, b) => a + b, 0) / v.lat.length) : 0,
      })),
      recent: recentRows.map((r) => ({
        id: r.id, botId: r.botId, event: r.event, ok: r.ok, status: r.status,
        latencyMs: r.latencyMs, attempts: r.attempts, bytes: r.bytes,
        error: r.error, response: r.response, trigger: r.trigger,
        createdAt: r.createdAt.toISOString(),
      })),
    };
  } catch {
    return {
      today: empty, week: empty, month: empty, allTime: empty,
      avgLatencyMs: null, p95LatencyMs: null, totalRetries: 0, totalBytes: 0,
      daily: [], perBot: [], recent: [],
    };
  }
}

/** একটি বটের সারসংক্ষেপ — বহু-বট তালিকায় দেখানোর জন্য */
export async function getBotStats(botIds: string[]): Promise<
  Record<string, { sent: number; failed: number; successRate: number; avgLatencyMs: number; lastOkAt: string | null; lastError: string | null; lastErrorAt: string | null }>
> {
  const out: Record<string, {
    sent: number; failed: number; successRate: number; avgLatencyMs: number;
    lastOkAt: string | null; lastError: string | null; lastErrorAt: string | null;
  }> = {};
  for (const id of botIds) {
    out[id] = { sent: 0, failed: 0, successRate: 100, avgLatencyMs: 0, lastOkAt: null, lastError: null, lastErrorAt: null };
  }
  if (botIds.length === 0) return out;
  try {
    const [grouped, lastOk, lastFail] = await Promise.all([
      prisma.telegramMessageLog.groupBy({
        by: ['botId', 'ok'], where: { botId: { in: botIds } },
        _count: { _all: true }, _avg: { latencyMs: true },
      }),
      prisma.telegramMessageLog.findMany({
        where: { botId: { in: botIds }, ok: true },
        orderBy: { createdAt: 'desc' }, distinct: ['botId'],
        select: { botId: true, createdAt: true },
      }),
      prisma.telegramMessageLog.findMany({
        where: { botId: { in: botIds }, ok: false },
        orderBy: { createdAt: 'desc' }, distinct: ['botId'],
        select: { botId: true, createdAt: true, error: true },
      }),
    ]);

    const lat = new Map<string, number[]>();
    for (const g of grouped) {
      const e = out[g.botId];
      if (!e) continue;
      if (g.ok) e.sent += g._count._all; else e.failed += g._count._all;
      if (g._avg.latencyMs != null) {
        const arr = lat.get(g.botId) ?? []; arr.push(g._avg.latencyMs); lat.set(g.botId, arr);
      }
    }
    for (const id of botIds) {
      const e = out[id];
      e.successRate = rate(e.sent, e.failed);
      const l = lat.get(id) ?? [];
      e.avgLatencyMs = l.length ? Math.round(l.reduce((a, b) => a + b, 0) / l.length) : 0;
    }
    for (const r of lastOk) if (out[r.botId]) out[r.botId].lastOkAt = r.createdAt.toISOString();
    for (const r of lastFail) {
      if (!out[r.botId]) continue;
      out[r.botId].lastError = r.error;
      out[r.botId].lastErrorAt = r.createdAt.toISOString();
    }
  } catch {
    /* ফাঁকা সারসংক্ষেপ ফেরত */
  }
  return out;
}
