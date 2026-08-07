import { prisma } from '../prisma';

/**
 * ═══════════════════════════════════════════════════════════
 * ★★★ টেলিগ্রাম টেলিমেট্রি — ড্যাশবোর্ডের সব সংখ্যা এখান থেকে।
 *
 *   ── ক্যাশ কেন **ভাঙা হয় না** ──
 *   `settings.ts` সব সেটিংস ৩০ সেকেন্ড ক্যাশ করে, যাতে প্রতিটি
 *   সার্ভার-রেন্ডারে Neon-এ রাউন্ড-ট্রিপ না লাগে। টেলিগ্রাম বার্তা
 *   যায় প্রতিটি অর্ডার/ডিপোজিটে — তাই এখানে `invalidateSettings()`
 *   ডাকলে সেই ক্যাশ অনবরত ভাঙত, আর একটি নোটিফিকেশন-ফিচার পুরো
 *   সাইটের পারফরম্যান্স নষ্ট করত।
 *
 *   তাই: **লেখা হয় ক্যাশ না ভেঙে**, আর পড়া হয় **সরাসরি DB থেকে**
 *   (`getStats`) — ড্যাশবোর্ড সবসময় তাজা সংখ্যা দেখায়।
 * ═══════════════════════════════════════════════════════════
 */

const K = {
  sent: 'telegram_stat_sent',
  failed: 'telegram_stat_failed',
  retries: 'telegram_stat_retries',
  lastOkAt: 'telegram_last_ok_at',
  lastOkEvent: 'telegram_last_ok_event',
  lastFailAt: 'telegram_last_fail_at',
  lastFailError: 'telegram_last_fail_error',
  lastApiResponse: 'telegram_last_api_response',
  lastCheckAt: 'telegram_last_check_at',
  lastLatency: 'telegram_last_latency_ms',
  connectedAt: 'telegram_connected_at',
} as const;

export type TelegramStats = {
  totalSent: number;
  totalFailed: number;
  totalRetries: number;
  lastOkAt: string | null;
  lastOkEvent: string | null;
  lastFailAt: string | null;
  lastFailError: string | null;
  lastApiResponse: string | null;
  lastCheckAt: string | null;
  lastLatencyMs: number | null;
  connectedAt: string | null;
};

/** ক্যাশ **না ভেঙে** একাধিক সারি লেখা */
async function write(rows: Record<string, string>): Promise<void> {
  const entries = Object.entries(rows);
  if (entries.length === 0) return;
  try {
    await prisma.$transaction(
      entries.map(([key, value]) =>
        prisma.setting.upsert({
          where: { key },
          update: { value },
          create: { key, value },
        }),
      ),
    );
  } catch {
    // টেলিমেট্রি কখনোই নোটিফিকেশন-ফ্লো ভাঙবে না
  }
}

/**
 * কাউন্টার বাড়ানো — SQL-এই যোগ করা হয় (read-modify-write নয়)।
 *
 *   কেন: একই মুহূর্তে দুটি অর্ডার এলে read-modify-write একটি গণনা
 *   হারাত (lost update)। `value::bigint + n` ডাটাবেসেই পরমাণু।
 */
async function bump(key: string, by = 1): Promise<void> {
  if (by <= 0) return;
  try {
    await prisma.$executeRaw`
      INSERT INTO "Setting" ("key", "value") VALUES (${key}, ${String(by)})
      ON CONFLICT ("key") DO UPDATE
      SET "value" = (COALESCE(NULLIF("Setting"."value", '')::bigint, 0) + ${by})::text
    `;
  } catch {
    /* উপেক্ষা */
  }
}

export async function recordSend(opts: {
  ok: boolean;
  event?: string;
  latencyMs?: number;
  attempts?: number;
  error?: string;
  apiResponse?: string;
}): Promise<void> {
  const now = new Date().toISOString();
  const rows: Record<string, string> = {};

  if (opts.latencyMs !== undefined) rows[K.lastLatency] = String(opts.latencyMs);
  if (opts.apiResponse) rows[K.lastApiResponse] = opts.apiResponse.slice(0, 300);

  if (opts.ok) {
    rows[K.lastOkAt] = now;
    rows[K.lastOkEvent] = opts.event || 'test';
    await bump(K.sent);
  } else {
    rows[K.lastFailAt] = now;
    rows[K.lastFailError] = (opts.error || 'অজানা ত্রুটি').slice(0, 300);
    await bump(K.failed);
  }

  // ★ প্রথম চেষ্টার পর প্রতিটি বাড়তি চেষ্টা = একটি retry
  const retries = Math.max(0, (opts.attempts ?? 1) - 1);
  if (retries > 0) await bump(K.retries, retries);

  await write(rows);
}

/** সংযোগ-পরীক্ষার ফল (getMe) — ড্যাশবোর্ডের "শেষ পরীক্ষা" ও latency */
export async function recordConnectionCheck(opts: {
  ok: boolean;
  latencyMs: number;
  apiResponse: string;
}): Promise<void> {
  const rows: Record<string, string> = {
    [K.lastCheckAt]: new Date().toISOString(),
    [K.lastLatency]: String(opts.latencyMs),
    [K.lastApiResponse]: opts.apiResponse.slice(0, 300),
  };
  if (opts.ok) rows[K.connectedAt] = new Date().toISOString();
  await write(rows);
}

const num = (v: string | undefined): number => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};

/** ★ সরাসরি DB থেকে — ৩০ সেকেন্ডের ক্যাশ এড়িয়ে (উপরের ব্যাখ্যা) */
export async function getStats(): Promise<TelegramStats> {
  try {
    const rows = await prisma.setting.findMany({
      where: { key: { in: Object.values(K) } },
    });
    const m = Object.fromEntries(rows.map((r) => [r.key, r.value]));
    return {
      totalSent: num(m[K.sent]),
      totalFailed: num(m[K.failed]),
      totalRetries: num(m[K.retries]),
      lastOkAt: m[K.lastOkAt] || null,
      lastOkEvent: m[K.lastOkEvent] || null,
      lastFailAt: m[K.lastFailAt] || null,
      lastFailError: m[K.lastFailError] || null,
      lastApiResponse: m[K.lastApiResponse] || null,
      lastCheckAt: m[K.lastCheckAt] || null,
      lastLatencyMs: m[K.lastLatency] ? num(m[K.lastLatency]) : null,
      connectedAt: m[K.connectedAt] || null,
    };
  } catch {
    return {
      totalSent: 0, totalFailed: 0, totalRetries: 0,
      lastOkAt: null, lastOkEvent: null, lastFailAt: null, lastFailError: null,
      lastApiResponse: null, lastCheckAt: null, lastLatencyMs: null, connectedAt: null,
    };
  }
}

/** পরিসংখ্যান শূন্য করা — "রিসেট কনফিগারেশন"-এর অংশ */
export async function resetStats(): Promise<void> {
  try {
    await prisma.setting.deleteMany({ where: { key: { in: Object.values(K) } } });
  } catch {
    /* উপেক্ষা */
  }
}
