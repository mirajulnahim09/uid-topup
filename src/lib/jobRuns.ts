import { prisma } from './prisma';
import { logger } from './logger';

/**
 * ═══════════════════════════════════════════════════════════
 * ★★★ শিডিউলড জবের শেষ-রান রেকর্ড (C2)
 *
 *   readiness endpoint-এ দেখাতে হবে "প্রতিটি জব সর্বশেষ কখন চলেছে"।
 *   নাহলে GitHub Actions চুপচাপ বন্ধ হয়ে গেলে (workflow disable,
 *   সিক্রেট মেয়াদোত্তীর্ণ, রিপো নিষ্ক্রিয়) কেউ টেরই পেত না — আর
 *   ঠিক সেই নীরব ব্যর্থতাই C2-এর মূল সমস্যা ছিল।
 *
 *   ── কেন `Setting` টেবিল, নতুন মডেল নয় ──
 *   নতুন Prisma মডেল = schema migration। CLAUDE.md §6 অনুযায়ী
 *   `schema.prisma` ছোঁয়ার আগে অনুমোদন লাগে, আর এইটুকু তথ্যের জন্য
 *   একটি migration চাপানো অতিরিক্ত। `Setting` (key/value) এমনিতেই
 *   এই ধরনের ছোট অ্যাপ-স্টেটের জন্য আছে।
 *
 *   ⚠️ কোনো ফাংশন throw করে না — জব রেকর্ড করতে না পারলেও জব নিজে
 *      সফল হয়েছে, সেটিকে ব্যর্থ বানানো ভুল হতো।
 * ═══════════════════════════════════════════════════════════
 */

export const JOB_KEYS = ['telegram-scheduler', 'sla-breach', 'ratelimit-cleanup'] as const;
export type JobKey = (typeof JOB_KEYS)[number];

export const JOB_LABELS: Record<JobKey, string> = {
  'telegram-scheduler': 'টেলিগ্রাম শিডিউলার (নির্ধারিত ব্রডকাস্ট)',
  'sla-breach': 'SLA ভঙ্গের সতর্কতা',
  'ratelimit-cleanup': 'রেট-লিমিট বাকেট পরিষ্কার',
};

/** প্রতিটি জব কত ঘন ঘন চলার কথা (মিনিট) — বাসি কিনা বোঝাতে */
export const JOB_EXPECTED_EVERY_MIN: Record<JobKey, number> = {
  'telegram-scheduler': 10,
  'sla-breach': 15,
  'ratelimit-cleanup': 24 * 60,
};

export type JobRun = {
  at: string;          // ISO
  ok: boolean;
  ms: number;
  detail?: string;
};

const settingKey = (job: JobKey) => `job_lastrun_${job}`;

/** একটি রানের ফল লিখে রাখা */
export async function recordJobRun(job: JobKey, run: JobRun): Promise<void> {
  try {
    const value = JSON.stringify(run);
    await prisma.setting.upsert({
      where: { key: settingKey(job) },
      create: { key: settingKey(job), value },
      update: { value },
    });
  } catch (e) {
    logger.error('cron', 'job run রেকর্ড করা যায়নি', { job, err: e });
  }
}

/** একটি জবের শেষ রান — না থাকলে null */
export async function getJobRun(job: JobKey): Promise<JobRun | null> {
  try {
    const row = await prisma.setting.findUnique({ where: { key: settingKey(job) } });
    if (!row) return null;
    return JSON.parse(row.value) as JobRun;
  } catch {
    return null;
  }
}

export type JobStatus = {
  key: JobKey;
  label: string;
  lastRunAt: string | null;
  ok: boolean | null;
  ms: number | null;
  detail?: string;
  /** কখনো চলেনি, বা প্রত্যাশিত সময়ের ২× পেরিয়ে গেছে */
  stale: boolean;
  expectedEveryMin: number;
};

/** readiness endpoint-এর জন্য তিনটির অবস্থা */
export async function getJobStatuses(): Promise<JobStatus[]> {
  const rows = await Promise.all(JOB_KEYS.map((k) => getJobRun(k)));
  const now = Date.now();

  return JOB_KEYS.map((key, i) => {
    const run = rows[i];
    const expectedEveryMin = JOB_EXPECTED_EVERY_MIN[key];
    // ★ ২× সহনশীলতা — GitHub Actions-এর নির্ধারিত রান নিয়মিত কয়েক
    //   মিনিট দেরিতে চলে (ফ্রি রানার সারি), তাই ঠিক সময়ে না এলেই
    //   "বাসি" বলা মিথ্যা অ্যালার্ম তৈরি করত।
    const stale = !run || now - new Date(run.at).getTime() > expectedEveryMin * 2 * 60_000;

    return {
      key,
      label: JOB_LABELS[key],
      lastRunAt: run?.at ?? null,
      ok: run?.ok ?? null,
      ms: run?.ms ?? null,
      detail: run?.detail,
      stale,
      expectedEveryMin,
    };
  });
}

/**
 * ★ জব-হ্যান্ডলারের মোড়ক — সময় মাপে, ফল রেকর্ড করে, ত্রুটি সহ।
 *   ব্যর্থ হলেও রেকর্ড হয় (`ok:false`), নাহলে readiness-এ কেবল
 *   "সর্বশেষ সফল রান" দেখা যেত আর ব্যর্থতা অদৃশ্য থাকত।
 */
export async function runJob<T>(
  job: JobKey,
  fn: () => Promise<{ result: T; detail?: string }>,
): Promise<{ ok: true; result: T; ms: number } | { ok: false; error: string; ms: number }> {
  const t0 = Date.now();
  try {
    const { result, detail } = await fn();
    const ms = Date.now() - t0;
    await recordJobRun(job, { at: new Date().toISOString(), ok: true, ms, detail });
    return { ok: true, result, ms };
  } catch (e) {
    const ms = Date.now() - t0;
    const error = e instanceof Error ? e.message : String(e);
    await recordJobRun(job, { at: new Date().toISOString(), ok: false, ms, detail: error });
    logger.error('cron', 'job ব্যর্থ', { job, err: e });
    return { ok: false, error, ms };
  }
}
