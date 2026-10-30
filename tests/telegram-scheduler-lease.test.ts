/**
 * ═══════════════════════════════════════════════════════════
 * ★★★ টেলিগ্রাম শিডিউলার — পরিত্যক্ত RUNNING-এর মেয়াদ
 *     (EXTREME অডিট, ২০২৬-০৯-১৯)
 *
 *   বাগ: প্রসেস মাঝপথে মরে গেলে জব `RUNNING`-এ আটকে থাকত, আর tick ও
 *   ম্যানুয়াল রান দুটোই সেটিকে চিরকাল এড়িয়ে যেত। দাবি:
 *     · ৩০ মিনিটের বেশি পুরনো RUNNING → পরের টিকে আবার চলে
 *     · সদ্য-দাবি করা RUNNING → ছোঁয়া হয় না (সত্যিকারের চলমান জব)
 *     · পরিত্যক্ত জবে একসাথে অনেক টিক → ঠিক একটি রান
 *     · পরিত্যক্ত রান-সারি FAILED হয় (ইতিহাসে চিরকাল "চলছে" নয়)
 *     · অ্যাডমিনের "এখনই চালান"-ও পরিত্যক্ত জব চালাতে পারে
 * ═══════════════════════════════════════════════════════════
 */
import { describe, it, expect } from 'vitest';
import { db } from '../vitest.setup';
import { tick, runJob, registerJobHandler } from '../src/lib/telegram/scheduler';

const KEY = 'lease_probe';
let handlerCalls = 0;
registerJobHandler(KEY, async () => {
  handlerCalls++;
  // ★ একটু সময় নেয় — একসাথে আসা টিকগুলোর দাবি সত্যিই ওভারল্যাপ করুক
  await new Promise((r) => setTimeout(r, 50));
  return { ok: true, detail: 'প্রোব' };
});

async function seedJob(status: 'IDLE' | 'RUNNING', minutesOld: number) {
  await db.telegramJob.create({
    data: {
      key: KEY, label: 'lease প্রোব', enabled: true, status,
      kind: 'ONCE', atHour: 0, atMinute: 0,
      nextRunAt: new Date(Date.now() - 60_000),
    },
  });
  await db.$executeRaw`UPDATE "TelegramJob"
    SET "updatedAt" = NOW() - make_interval(mins => ${minutesOld}::int) WHERE key = ${KEY}`;
}

describe('টেলিগ্রাম শিডিউলার — RUNNING lease', () => {
  it('৪৫ মিনিট পুরনো পরিত্যক্ত RUNNING জব পরের টিকে চলে', async () => {
    handlerCalls = 0;
    await seedJob('RUNNING', 45);

    const r = await tick();

    expect(r.ran).toContain(KEY);
    expect(handlerCalls).toBe(1);
    const job = await db.telegramJob.findUniqueOrThrow({ where: { key: KEY } });
    expect(job.status).not.toBe('RUNNING');
    expect(job.lastStatus).toBe('SUCCESS');
  });

  it('সদ্য-দাবি করা RUNNING (২ মিনিট) ছিনিয়ে নেওয়া হয় না', async () => {
    handlerCalls = 0;
    await seedJob('RUNNING', 2);

    const r = await tick();

    expect(r.ran).not.toContain(KEY);
    expect(handlerCalls).toBe(0);
    const job = await db.telegramJob.findUniqueOrThrow({ where: { key: KEY } });
    expect(job.status).toBe('RUNNING');
  });

  it('পরিত্যক্ত জবে একসাথে ৫টি টিক — ঠিক একটি রান', async () => {
    handlerCalls = 0;
    await seedJob('RUNNING', 45);

    const results = await Promise.all([1, 2, 3, 4, 5].map(() => tick()));

    const ranCount = results.filter((x) => x.ran.includes(KEY)).length;
    expect(ranCount).toBe(1);
    expect(handlerCalls).toBe(1);
    expect(await db.telegramJobRun.count({ where: { jobKey: KEY } })).toBe(1);
  });

  it('পরিত্যক্ত রান-সারি FAILED হয়, সাম্প্রতিকটি অক্ষত থাকে', async () => {
    await seedJob('IDLE', 0);
    await db.telegramJob.update({ where: { key: KEY }, data: { nextRunAt: null } });
    const old = await db.telegramJobRun.create({
      data: { jobKey: KEY, status: 'RUNNING', startedAt: new Date(Date.now() - 45 * 60_000) },
    });
    const fresh = await db.telegramJobRun.create({
      data: { jobKey: KEY, status: 'RUNNING', startedAt: new Date(Date.now() - 60_000) },
    });

    await tick();

    const o = await db.telegramJobRun.findUniqueOrThrow({ where: { id: old.id } });
    const f = await db.telegramJobRun.findUniqueOrThrow({ where: { id: fresh.id } });
    expect(o.status).toBe('FAILED');
    expect(o.finishedAt).not.toBeNull();
    expect(f.status).toBe('RUNNING');
  });

  it('"এখনই চালান" (MANUAL) — পরিত্যক্ত জব চলে, সদ্য-চলমান জব নয়', async () => {
    handlerCalls = 0;
    await seedJob('RUNNING', 2);
    const busy = await runJob(KEY, 'MANUAL');
    expect(busy.ok).toBe(false);
    expect(handlerCalls).toBe(0);

    await db.$executeRaw`UPDATE "TelegramJob"
      SET "updatedAt" = NOW() - INTERVAL '45 minutes' WHERE key = ${KEY}`;
    const recovered = await runJob(KEY, 'MANUAL');
    expect(recovered.ok).toBe(true);
    expect(handlerCalls).toBe(1);
  });
});
