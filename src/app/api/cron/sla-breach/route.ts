import { apiError } from '@/lib/guard';
import { assertCronAuth } from '@/lib/cronAuth';
import { runJob, getJobRun } from '@/lib/jobRuns';
import { prisma } from '@/lib/prisma';
import { breachInfo, breachLabel, SLA_WARN_MIN } from '@/lib/slaBreach';
import { notifyAdmins } from '@/lib/notify';

export const dynamic = 'force-dynamic';

/** প্রথম রানে কত পিছন পর্যন্ত দেখব (নাহলে পুরনো সব ভঙ্গ একসাথে আসত) */
const FIRST_RUN_LOOKBACK_MS = 24 * 60 * 60 * 1000;
/** এক বার্তায় সর্বোচ্চ কয়টি অর্ডার নাম ধরে বলা হবে */
const MAX_LISTED = 15;

/**
 * ★★★ cron: SLA ভঙ্গের সতর্কতা (C2 · প্রতি ১৫ মিনিট)
 *
 *   ── কেন এটি দরকার ছিল ──
 *   `src/lib/slaBreach.ts` ভঙ্গ **হিসাব** করত, কিন্তু কেউ সেটি
 *   পাঠাত না — ফাইলের নিজের মন্তব্যেই লেখা ছিল "এটি *দেখার*
 *   সতর্কতা, *পাঠানোর* নয়… শিডিউলার লাগে যা এখানে নেই"। ফলে
 *   অ্যাডমিন অ্যাডমিন-পাতা না খুললে দেরি হওয়া অর্ডার চোখেই পড়ত না।
 *
 *   ── পুনরাবৃত্তি ঠেকানো ──
 *   প্রতি ১৫ মিনিটে চললে একই ভঙ্গ বারবার পাঠানো হতো — অ্যাডমিন
 *   কয়েক ঘণ্টায় বার্তা দেখাই বন্ধ করে দিতেন। তাই কেবল **শেষ রানের
 *   পর নতুন করে ভঙ্গ হওয়া** অর্ডারগুলোই বার্তায় যায়। কোনো নতুন
 *   ভঙ্গ না থাকলে কোনো বার্তা যায় না।
 *
 *   ⚠️ কোনো DB কলাম লেখা হয় না — ভঙ্গ derived-ই থাকে (`slaDueAt` +
 *      ঘড়ি)। কেবল শেষ-রানের সময় `Setting`-এ থাকে।
 */
async function handle(req: Request) {
  try {
    assertCronAuth(req, 'sla-breach');

    const r = await runJob('sla-breach', async () => {
      const now = new Date();
      const prev = await getJobRun('sla-breach');
      // ★ শেষ **সফল** রানের সময় থেকে; না থাকলে ২৪ ঘণ্টা পিছন
      const since = prev?.ok
        ? new Date(prev.at)
        : new Date(now.getTime() - FIRST_RUN_LOOKBACK_MS);

      const open = await prisma.order.findMany({
        where: {
          status: { in: ['PENDING', 'PROCESSING'] },
          slaDueAt: { not: null },
        },
        select: { id: true, orderNo: true, slaDueAt: true, status: true },
        orderBy: { slaDueAt: 'asc' },
      });

      let breached = 0;
      let soon = 0;
      const fresh: { orderNo: number; label: string }[] = [];

      for (const o of open) {
        const info = breachInfo(o, now);
        if (info.level === 'breached') {
          breached++;
          // ★ "নতুন" = নির্ধারিত সময় শেষ রানের পরে পেরিয়েছে
          const due = o.slaDueAt as Date;
          if (due > since) fresh.push({ orderNo: o.orderNo, label: breachLabel(info) });
        } else if (info.level === 'soon') {
          soon++;
        }
      }

      if (fresh.length) {
        const listed = fresh.slice(0, MAX_LISTED)
          .map((f) => `• #${f.orderNo} — ${f.label}`).join('\n');
        const more = fresh.length > MAX_LISTED
          ? `\n…আরও ${fresh.length - MAX_LISTED} টি`
          : '';
        await notifyAdmins(
          `⏰ SLA ভঙ্গ — ${fresh.length} টি নতুন`,
          `${listed}${more}\n\nমোট দেরি: ${breached} টি · ${SLA_WARN_MIN} মিনিটের কম বাকি: ${soon} টি`,
          '/admin/orders',
          'sla_breach',
        );
      }

      return {
        result: { checked: open.length, breached, soon, notified: fresh.length },
        detail: fresh.length
          ? `${fresh.length} টি নতুন ভঙ্গ জানানো হয়েছে (মোট দেরি ${breached})`
          : `নতুন ভঙ্গ নেই (মোট দেরি ${breached} · শীঘ্রই ${soon})`,
      };
    });

    if (!r.ok) return Response.json({ success: false, error: r.error, ms: r.ms }, { status: 500 });
    return Response.json({ success: true, ...r.result, ms: r.ms, at: new Date().toISOString() });
  } catch (e) {
    return apiError(e);
  }
}

export const POST = handle;
export const GET = handle;
