import { prisma } from '@/lib/prisma';
import { requireAdmin, apiError, ApiError, readJson } from '@/lib/guard';
import { adminLog } from '@/lib/adminLog';
import { getIp } from '@/lib/rateLimit';
import {
  ensureJobsSeeded, computeNextRun, runJob, tick, retryFailed,
  ensureSchedulerStarted, schedulerRunning, hasHandler,
  JOB_CATALOG, DEFAULT_TZ, type JobKind, type ScheduleSpec,
} from '@/lib/telegram/scheduler';
import '@/lib/telegram/handlers'; // ★ হ্যান্ডলার রেজিস্টার করার জন্য import জরুরি

export const dynamic = 'force-dynamic';

const KINDS: JobKind[] = ['ONCE', 'HOURLY', 'DAILY', 'WEEKLY', 'MONTHLY'];

/** ★ পাতা/API ছোঁয়ামাত্র শিডিউলার চালু — আলাদা bootstrap লাগে না */
function boot() {
  ensureSchedulerStarted();
}

export async function GET() {
  try {
    await requireAdmin();
    boot();
    await ensureJobsSeeded();

    const [jobs, runs, agg] = await Promise.all([
      prisma.telegramJob.findMany({ orderBy: [{ enabled: 'desc' }, { nextRunAt: 'asc' }] }),
      prisma.telegramJobRun.findMany({ orderBy: { startedAt: 'desc' }, take: 30 }),
      prisma.telegramJobRun.groupBy({ by: ['status'], _count: { _all: true } }),
    ]);

    const counts = Object.fromEntries(agg.map((a) => [a.status, a._count._all]));

    return Response.json({
      schedulerRunning: schedulerRunning(),
      timezone: DEFAULT_TZ,
      kinds: KINDS,
      summary: {
        total: jobs.length,
        enabled: jobs.filter((j) => j.enabled).length,
        running: jobs.filter((j) => j.status === 'RUNNING').length,
        paused: jobs.filter((j) => !j.enabled).length,
        completed: counts.SUCCESS ?? 0,
        failed: counts.FAILED ?? 0,
      },
      jobs: jobs.map((j) => ({
        key: j.key, label: j.label, description: j.description,
        enabled: j.enabled, status: j.status,
        kind: j.kind, atHour: j.atHour, atMinute: j.atMinute,
        weekday: j.weekday, dayOfMonth: j.dayOfMonth, timezone: j.timezone,
        runOnceAt: j.runOnceAt?.toISOString() ?? null,
        nextRunAt: j.nextRunAt?.toISOString() ?? null,
        lastRunAt: j.lastRunAt?.toISOString() ?? null,
        lastStatus: j.lastStatus, lastError: j.lastError, lastMs: j.lastMs,
        runCount: j.runCount, failCount: j.failCount,
        avgMs: j.runCount > 0 ? Math.round(j.totalMs / j.runCount) : null,
        hasHandler: hasHandler(j.key),
      })),
      history: runs.map((r) => ({
        id: r.id, jobKey: r.jobKey, trigger: r.trigger, status: r.status,
        startedAt: r.startedAt.toISOString(),
        finishedAt: r.finishedAt?.toISOString() ?? null,
        ms: r.ms, detail: r.detail, error: r.error,
      })),
    });
  } catch (e) {
    return apiError(e);
  }
}

export async function POST(req: Request) {
  try {
    const admin = await requireAdmin();
    boot();
    const body = await readJson<{
      action?: string; key?: string;
      kind?: string; atHour?: number; atMinute?: number;
      weekday?: number | null; dayOfMonth?: number | null;
      timezone?: string; runOnceAt?: string | null;
      enabled?: boolean;
    }>(req);

    const log = (d: string) => adminLog({
      adminId: admin.id, adminName: admin.name, action: 'SETTINGS_CHANGE',
      detail: `টেলিগ্রাম শিডিউলার — ${d}`, ip: getIp(req),
    }).catch(() => {});

    switch (body.action) {
      // ── সময়সূচি সংরক্ষণ ──
      case 'save': {
        if (!body.key) throw new ApiError('key দরকার', 400);
        const job = await prisma.telegramJob.findUnique({ where: { key: body.key } });
        if (!job) throw new ApiError('জব পাওয়া যায়নি', 404);

        const kind = (KINDS as string[]).includes(String(body.kind))
          ? (body.kind as JobKind) : (job.kind as JobKind);
        const atHour = Math.min(23, Math.max(0, Number(body.atHour ?? job.atHour)));
        const atMinute = Math.min(59, Math.max(0, Number(body.atMinute ?? job.atMinute)));
        const weekday = body.weekday === undefined ? job.weekday
          : body.weekday === null ? null : Math.min(6, Math.max(0, Number(body.weekday)));
        // ★ ২৮-এ সীমাবদ্ধ — ৩১ দিলে ফেব্রুয়ারিতে জব কখনো চলত না
        const dayOfMonth = body.dayOfMonth === undefined ? job.dayOfMonth
          : body.dayOfMonth === null ? null : Math.min(28, Math.max(1, Number(body.dayOfMonth)));
        const timezone = String(body.timezone || job.timezone || DEFAULT_TZ);
        const runOnceAt = body.runOnceAt ? new Date(body.runOnceAt) : job.runOnceAt;
        const enabled = body.enabled === undefined ? job.enabled : Boolean(body.enabled);

        const spec: ScheduleSpec = { kind, atHour, atMinute, weekday, dayOfMonth, timezone, runOnceAt };
        const nextRunAt = enabled ? computeNextRun(spec) : null;

        await prisma.telegramJob.update({
          where: { key: body.key },
          data: {
            kind, atHour, atMinute, weekday, dayOfMonth, timezone, runOnceAt,
            enabled, status: enabled ? 'IDLE' : 'PAUSED', nextRunAt,
          },
        });
        log(`${body.key} — ${kind} ${atHour}:${String(atMinute).padStart(2, '0')} ${timezone}${enabled ? '' : ' (বন্ধ)'}`);
        return Response.json({ success: true, nextRunAt: nextRunAt?.toISOString() ?? null });
      }

      case 'pause':
      case 'resume': {
        if (!body.key) throw new ApiError('key দরকার', 400);
        const on = body.action === 'resume';
        const job = await prisma.telegramJob.findUnique({ where: { key: body.key } });
        if (!job) throw new ApiError('জব পাওয়া যায়নি', 404);
        const spec: ScheduleSpec = {
          kind: job.kind as JobKind, atHour: job.atHour, atMinute: job.atMinute,
          weekday: job.weekday, dayOfMonth: job.dayOfMonth,
          timezone: job.timezone, runOnceAt: job.runOnceAt,
        };
        await prisma.telegramJob.update({
          where: { key: body.key },
          data: {
            enabled: on, status: on ? 'IDLE' : 'PAUSED',
            nextRunAt: on ? computeNextRun(spec) : null,
          },
        });
        log(`${body.key} — ${on ? 'চালু' : 'বিরতি'}`);
        return Response.json({ success: true });
      }

      case 'stop': {
        if (!body.key) throw new ApiError('key দরকার', 400);
        await prisma.telegramJob.update({
          where: { key: body.key },
          data: { enabled: false, status: 'STOPPED', nextRunAt: null },
        });
        log(`${body.key} — বন্ধ`);
        return Response.json({ success: true });
      }

      // ── ম্যানুয়াল ট্রিগার ──
      case 'run': {
        if (!body.key) throw new ApiError('key দরকার', 400);
        if (!hasHandler(body.key)) throw new ApiError('এই জবের কোনো হ্যান্ডলার নেই', 400);
        const r = await runJob(body.key, 'MANUAL');
        log(`${body.key} — ম্যানুয়াল রান (${r.ok ? 'সফল' : 'ব্যর্থ'})`);
        if (!r.ok) throw new ApiError(r.error || 'জব ব্যর্থ', 400);
        return Response.json({ success: true, message: r.detail || 'জব সফল', detail: r.detail });
      }

      case 'tick': {
        const r = await tick();
        return Response.json({ success: true, ran: r.ran, skipped: r.skipped });
      }

      case 'retry-failed': {
        const keys = await retryFailed();
        log(`ব্যর্থ জব পুনরায় (${keys.length}টি)`);
        return Response.json({ success: true, retried: keys });
      }

      case 'seed': {
        const n = await ensureJobsSeeded();
        return Response.json({ success: true, created: n, catalog: JOB_CATALOG.length });
      }

      default:
        throw new ApiError('অজানা কাজ', 400);
    }
  } catch (e) {
    return apiError(e);
  }
}
