import { prisma } from '../prisma';
import { logger } from '../logger';
import { scrub } from './api';

/**
 * ═══════════════════════════════════════════════════════════
 * ★★★ টেলিগ্রাম শিডিউলার ইঞ্জিন
 *
 *   ⚠️ **স্পষ্ট করে বলা দরকার:** এই প্রকল্পে আগে থেকে কোনো শিডিউলার
 *   ছিল না (আগের দুটি রিপোর্টেও তা লেখা আছে)। তাই এটি "বিদ্যমান
 *   সিস্টেমে যুক্ত করা" নয় — এটি **নতুন করে বানানো**।
 *
 *   ── কীভাবে চলে ──
 *   ১. **ইন-প্রসেস টিক** (`ensureSchedulerStarted`) — প্রতি ৩০ সেকেন্ডে
 *      বকেয়া জব খোঁজে। দীর্ঘ-চলমান সার্ভার (EXE / VPS / `next start`)-এ
 *      এটাই যথেষ্ট, বাইরের কিছু লাগে না।
 *   ২. **বাহ্যিক ট্রিগার** (`POST /api/admin/telegram/scheduler/tick`) —
 *      serverless-এ প্রসেস বাঁচে না, তাই সেখানে Vercel Cron / Windows
 *      Task Scheduler এই endpoint ডাকবে। একই কোড, দুই প্রবেশপথ।
 *
 *   ── দৌড় (race) ঠেকানো ──
 *   দুটি টিক একসাথে চললে একই জব দুবার চলে যেতে পারত। তাই দাবি করা হয়
 *   **শর্তসাপেক্ষ UPDATE** দিয়ে: `WHERE status <> 'RUNNING' AND nextRunAt <= now`।
 *   যে টিক সারিটি বদলাতে পারে, সেই-ই জবটি চালায়; অন্যজন খালি হাতে ফেরে।
 * ═══════════════════════════════════════════════════════════
 */

export type JobKind = 'ONCE' | 'HOURLY' | 'DAILY' | 'WEEKLY' | 'MONTHLY';
export type JobStatus = 'IDLE' | 'RUNNING' | 'PAUSED' | 'STOPPED';

/** বিল্ট-ইন জব — প্রতিটির একটি হ্যান্ডলার আছে (`handlers.ts`) */
export const JOB_CATALOG = [
  { key: 'daily_summary', label: 'দৈনিক সেলস সারসংক্ষেপ', kind: 'DAILY' as JobKind, atHour: 21, atMinute: 0 },
  { key: 'weekly_report', label: 'সাপ্তাহিক রিপোর্ট', kind: 'WEEKLY' as JobKind, atHour: 10, atMinute: 0, weekday: 5 },
  { key: 'monthly_report', label: 'মাসিক রিপোর্ট', kind: 'MONTHLY' as JobKind, atHour: 10, atMinute: 0, dayOfMonth: 1 },
  { key: 'pending_orders', label: 'পেন্ডিং অর্ডার রিমাইন্ডার', kind: 'HOURLY' as JobKind, atHour: 0, atMinute: 30 },
  { key: 'pending_deposits', label: 'পেন্ডিং ডিপোজিট রিমাইন্ডার', kind: 'HOURLY' as JobKind, atHour: 0, atMinute: 15 },
  { key: 'low_stock_scan', label: 'স্টক সতর্কতা স্ক্যান', kind: 'DAILY' as JobKind, atHour: 11, atMinute: 0 },
  { key: 'maintenance_reminder', label: 'মেইনটেন্যান্স রিমাইন্ডার', kind: 'DAILY' as JobKind, atHour: 8, atMinute: 0 },
  { key: 'campaign_start', label: 'ক্যাম্পেইন শুরু', kind: 'HOURLY' as JobKind, atHour: 0, atMinute: 5 },
  { key: 'campaign_end', label: 'ক্যাম্পেইন শেষ', kind: 'HOURLY' as JobKind, atHour: 0, atMinute: 10 },
  { key: 'coupon_expiry', label: 'কুপনের মেয়াদ শেষ', kind: 'DAILY' as JobKind, atHour: 9, atMinute: 30 },
  { key: 'server_health', label: 'সার্ভার হেলথ রিপোর্ট', kind: 'DAILY' as JobKind, atHour: 7, atMinute: 0 },
  { key: 'backup_status', label: 'ব্যাকআপ সফলতার রিপোর্ট', kind: 'DAILY' as JobKind, atHour: 3, atMinute: 30 },
  { key: 'restart_notice', label: 'সিস্টেম রিস্টার্ট নোটিফিকেশন', kind: 'ONCE' as JobKind, atHour: 0, atMinute: 0 },
  { key: 'security_digest', label: 'নিরাপত্তা সতর্কতা সারাংশ', kind: 'DAILY' as JobKind, atHour: 6, atMinute: 0 },
  { key: 'failed_logins', label: 'ব্যর্থ লগইন সারাংশ', kind: 'DAILY' as JobKind, atHour: 6, atMinute: 30 },
  { key: 'fraud_report', label: 'সন্দেহজনক কার্যকলাপ রিপোর্ট', kind: 'DAILY' as JobKind, atHour: 6, atMinute: 45 },
] as const;

export type JobKey = (typeof JOB_CATALOG)[number]['key'];

export const DEFAULT_TZ = 'Asia/Dhaka';

/**
 * ★ টাইমজোন-সচেতন পরবর্তী-চালানোর সময়।
 *
 *   `Intl.DateTimeFormat` দিয়ে লক্ষ্য টাইমজোনে "এখন কটা" বের করে
 *   পার্থক্য হিসাব করা হয়। বাইরের কোনো লাইব্রেরি (dayjs/luxon) যোগ
 *   করা হয়নি — একটিমাত্র হিসাবের জন্য নির্ভরতা বাড়ানো অপচয়, আর
 *   DST-সহ সঠিক অফসেট Intl নিজেই দেয়।
 */
function tzOffsetMinutes(date: Date, timeZone: string): number {
  try {
    const dtf = new Intl.DateTimeFormat('en-US', {
      timeZone, hour12: false,
      year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit',
    });
    const parts = Object.fromEntries(dtf.formatToParts(date).map((p) => [p.type, p.value]));
    const asUtc = Date.UTC(
      Number(parts.year), Number(parts.month) - 1, Number(parts.day),
      Number(parts.hour), Number(parts.minute), Number(parts.second),
    );
    return (asUtc - date.getTime()) / 60000;
  } catch {
    return 0; // অজানা টাইমজোন → UTC হিসেবে ধরি
  }
}

/** লক্ষ্য টাইমজোনে দেওয়া ঘড়ি-সময়কে প্রকৃত UTC মুহূর্তে রূপান্তর */
function zonedTimeToUtc(y: number, mo: number, d: number, h: number, mi: number, tz: string): Date {
  const guess = new Date(Date.UTC(y, mo, d, h, mi, 0));
  const off = tzOffsetMinutes(guess, tz);
  return new Date(guess.getTime() - off * 60000);
}

export type ScheduleSpec = {
  kind: JobKind;
  atHour: number;
  atMinute: number;
  weekday?: number | null;
  dayOfMonth?: number | null;
  timezone: string;
  runOnceAt?: Date | null;
};

/** পরবর্তী চালানোর মুহূর্ত (UTC) — `from` এর কড়াকড়িভাবে পরে */
export function computeNextRun(spec: ScheduleSpec, from: Date = new Date()): Date | null {
  const tz = spec.timezone || DEFAULT_TZ;

  if (spec.kind === 'ONCE') {
    if (!spec.runOnceAt) return null;
    return spec.runOnceAt > from ? spec.runOnceAt : null;
  }

  if (spec.kind === 'HOURLY') {
    const next = new Date(from);
    next.setUTCSeconds(0, 0);
    const m = spec.atMinute % 60;
    next.setUTCMinutes(m);
    if (next <= from) next.setUTCHours(next.getUTCHours() + 1);
    return next;
  }

  // লক্ষ্য টাইমজোনে আজকের তারিখ বের করি
  const off = tzOffsetMinutes(from, tz);
  const localNow = new Date(from.getTime() + off * 60000);
  const y = localNow.getUTCFullYear();
  const mo = localNow.getUTCMonth();
  const d = localNow.getUTCDate();

  if (spec.kind === 'DAILY') {
    let cand = zonedTimeToUtc(y, mo, d, spec.atHour, spec.atMinute, tz);
    if (cand <= from) cand = zonedTimeToUtc(y, mo, d + 1, spec.atHour, spec.atMinute, tz);
    return cand;
  }

  if (spec.kind === 'WEEKLY') {
    const want = ((spec.weekday ?? 5) % 7 + 7) % 7;
    for (let i = 0; i <= 7; i++) {
      const cand = zonedTimeToUtc(y, mo, d + i, spec.atHour, spec.atMinute, tz);
      const localCand = new Date(cand.getTime() + tzOffsetMinutes(cand, tz) * 60000);
      if (localCand.getUTCDay() === want && cand > from) return cand;
    }
    return null;
  }

  // MONTHLY — ২৮ দিনের বেশি নয়, তাই প্রতিটি মাসেই দিনটি থাকে
  const dom = Math.min(Math.max(spec.dayOfMonth ?? 1, 1), 28);
  let cand = zonedTimeToUtc(y, mo, dom, spec.atHour, spec.atMinute, tz);
  if (cand <= from) cand = zonedTimeToUtc(y, mo + 1, dom, spec.atHour, spec.atMinute, tz);
  return cand;
}

/** কোনো জব না থাকলে ক্যাটালগ থেকে তৈরি করি (একবারই) */
export async function ensureJobsSeeded(): Promise<number> {
  try {
    const existing = await prisma.telegramJob.findMany({ select: { key: true } });
    const have = new Set(existing.map((j) => j.key));
    let created = 0;
    for (const j of JOB_CATALOG) {
      if (have.has(j.key)) continue;
      const spec: ScheduleSpec = {
        kind: j.kind, atHour: j.atHour, atMinute: j.atMinute,
        weekday: 'weekday' in j ? j.weekday : null,
        dayOfMonth: 'dayOfMonth' in j ? j.dayOfMonth : null,
        timezone: DEFAULT_TZ,
      };
      await prisma.telegramJob.create({
        data: {
          key: j.key, label: j.label,
          kind: j.kind, atHour: j.atHour, atMinute: j.atMinute,
          weekday: spec.weekday ?? null, dayOfMonth: spec.dayOfMonth ?? null,
          timezone: DEFAULT_TZ,
          // ★ ডিফল্টে **বন্ধ** — ইনস্টল করামাত্র ১৬টি স্বয়ংক্রিয় বার্তা
          //   শুরু হয়ে গেলে সেটি উপদ্রব; অ্যাডমিন বেছে নিক।
          enabled: false,
          status: 'PAUSED',
          nextRunAt: computeNextRun(spec),
        },
      });
      created++;
    }
    return created;
  } catch (e) {
    logger.error('telegram', 'job seed failed', { error: scrub(String(e)) });
    return 0;
  }
}

export type RunResult = { ok: boolean; detail?: string; error?: string };

/** হ্যান্ডলার রেজিস্ট্রি — `handlers.ts` এটি পূরণ করে (বৃত্তাকার import এড়াতে) */
const handlers = new Map<string, () => Promise<RunResult>>();
export function registerJobHandler(key: string, fn: () => Promise<RunResult>): void {
  handlers.set(key, fn);
}
export function hasHandler(key: string): boolean {
  return handlers.has(key);
}

/**
 * একটি জব চালানো। `trigger` = MANUAL হলে সময়সূচি উপেক্ষা করে চলে।
 * কখনো throw করে না — ব্যর্থতা রান-ইতিহাসে লেখা হয়।
 */
export async function runJob(
  key: string,
  trigger: 'SCHEDULE' | 'MANUAL' | 'RETRY' = 'MANUAL',
): Promise<RunResult> {
  const started = Date.now();
  let runId: string | null = null;
  try {
    const job = await prisma.telegramJob.findUnique({ where: { key } });
    if (!job) return { ok: false, error: 'জব পাওয়া যায়নি' };

    // ★★★ BUG-fix: double-run গার্ড। tick (SCHEDULE) আগেই atomic claim
    //   করে status=RUNNING সেট করে আসে, কিন্তু MANUAL ("এখনই চালান") ও
    //   RETRY সরাসরি এখানে আসত — claim ছাড়া। ফলে admin manual run + tick
    //   একসাথে হলে একই job দুবার চলত (broadcast হলে ইউজার দুটো মেসেজ পেত)।
    //   এখন MANUAL/RETRY-ও atomic claim করে: RUNNING হলে skip।
    //   SCHEDULE trigger tick থেকে আসে (ইতিমধ্যে claimed), তাই তাকে
    //   আবার claim করানো লাগে না — নাহলে নিজের claim-এই আটকে যেত।
    if (trigger !== 'SCHEDULE') {
      const claimed = await prisma.telegramJob.updateMany({
        where: { key, status: { not: 'RUNNING' } },
        data: { status: 'RUNNING' },
      });
      if (claimed.count === 0) {
        return { ok: false, error: 'জবটি এখন চলছে — একটু পরে দেখুন' };
      }
    }

    const run = await prisma.telegramJobRun.create({
      data: { jobKey: key, trigger, status: 'RUNNING' },
    });
    runId = run.id;

    await prisma.telegramJob.update({
      where: { key }, data: { status: 'RUNNING' },
    });

    const fn = handlers.get(key);
    const result: RunResult = fn
      ? await fn()
      : { ok: false, error: 'এই জবের কোনো হ্যান্ডলার নেই' };

    const ms = Date.now() - started;
    await prisma.telegramJobRun.update({
      where: { id: run.id },
      data: {
        status: result.ok ? 'SUCCESS' : 'FAILED',
        finishedAt: new Date(), ms,
        detail: result.detail?.slice(0, 400) ?? null,
        error: result.error ? scrub(result.error).slice(0, 400) : null,
      },
    });

    const spec: ScheduleSpec = {
      kind: job.kind as JobKind, atHour: job.atHour, atMinute: job.atMinute,
      weekday: job.weekday, dayOfMonth: job.dayOfMonth,
      timezone: job.timezone, runOnceAt: job.runOnceAt,
    };

    await prisma.telegramJob.update({
      where: { key },
      data: {
        // ★ থামানো/বিরতি দেওয়া জব চালানোর পর আবার সেই অবস্থাতেই ফিরুক
        status: job.enabled ? 'IDLE' : 'PAUSED',
        lastRunAt: new Date(),
        lastStatus: result.ok ? 'SUCCESS' : 'FAILED',
        lastError: result.error ? scrub(result.error).slice(0, 300) : null,
        lastMs: ms,
        runCount: { increment: 1 },
        failCount: result.ok ? undefined : { increment: 1 },
        totalMs: { increment: ms },
        nextRunAt: job.enabled ? computeNextRun(spec) : null,
      },
    });

    return result;
  } catch (e) {
    const msg = scrub(e instanceof Error ? e.message : String(e));
    if (runId) {
      await prisma.telegramJobRun.update({
        where: { id: runId },
        data: { status: 'FAILED', finishedAt: new Date(), ms: Date.now() - started, error: msg.slice(0, 400) },
      }).catch(() => {});
    }
    await prisma.telegramJob.update({
      where: { key },
      data: { status: 'IDLE', lastStatus: 'FAILED', lastError: msg.slice(0, 300) },
    }).catch(() => {});
    return { ok: false, error: msg };
  }
}

/**
 * বকেয়া জব চালানো। দুই প্রবেশপথ (ইন-প্রসেস টিক ও বাহ্যিক endpoint)
 * একই ফাংশনে আসে, তাই আচরণ অভিন্ন।
 */
export async function tick(): Promise<{ ran: string[]; skipped: number }> {
  const ran: string[] = [];
  let skipped = 0;
  try {
    const now = new Date();
    const due = await prisma.telegramJob.findMany({
      where: { enabled: true, status: { not: 'RUNNING' }, nextRunAt: { lte: now } },
      select: { key: true },
      take: 10, // এক টিকে সর্বোচ্চ ১০টি — বাকিগুলো পরের টিকে
    });

    for (const j of due) {
      // ★★★ পরমাণু দাবি — দুটি টিক একসাথে চললেও একজনই জিতবে।
      //   `updateMany` শর্ত না মিললে count 0 দেয়, তখন অন্যজন ধরে নিয়েছে।
      const claimed = await prisma.telegramJob.updateMany({
        where: { key: j.key, status: { not: 'RUNNING' }, nextRunAt: { lte: now } },
        data: { status: 'RUNNING' },
      });
      if (claimed.count === 0) { skipped++; continue; }
      await runJob(j.key, 'SCHEDULE');
      ran.push(j.key);
    }
  } catch (e) {
    logger.error('telegram', 'scheduler tick failed', { error: scrub(String(e)) });
  }
  return { ran, skipped };
}

/** ব্যর্থ জব আবার চালানো */
export async function retryFailed(): Promise<string[]> {
  const failed = await prisma.telegramJob.findMany({
    where: { lastStatus: 'FAILED', enabled: true },
    select: { key: true }, take: 10,
  });
  const out: string[] = [];
  for (const f of failed) {
    await runJob(f.key, 'RETRY');
    out.push(f.key);
  }
  return out;
}

// ─────────────────── ইন-প্রসেস টিক ───────────────────

const TICK_MS = 30_000;
declare global {
  // eslint-disable-next-line no-var
  var __tgSchedulerTimer: NodeJS.Timeout | undefined;
}

/**
 * টিক-লুপ চালু করা। **idempotent** — বহুবার ডাকলেও একটিই টাইমার
 * থাকে (`globalThis`-এ রাখা, কারণ dev-এ hot-reload মডিউল রিসেট করে
 * আর প্রতিবার নতুন টাইমার জমতে থাকত)।
 */
export function ensureSchedulerStarted(): void {
  if (globalThis.__tgSchedulerTimer) return;
  const t = setInterval(() => { void tick(); }, TICK_MS);
  // ★ টাইমার যেন প্রক্রিয়া বাঁচিয়ে না রাখে (CLI/বিল্ডে ঝুলে থাকত)
  if (typeof t.unref === 'function') t.unref();
  globalThis.__tgSchedulerTimer = t;
  logger.info('telegram', 'scheduler started', { intervalMs: TICK_MS });
}

export function schedulerRunning(): boolean {
  return Boolean(globalThis.__tgSchedulerTimer);
}
