import { apiError } from '@/lib/guard';
import { assertCronAuth } from '@/lib/cronAuth';
import { runJobExclusive, getJobRun } from '@/lib/jobRuns';
import { prisma } from '@/lib/prisma';
import { breachInfo, breachLabel, SLA_WARN_MIN } from '@/lib/slaBreach';
import { notifyAdmins } from '@/lib/notify';
import { sweepStuckAutoFulfill } from '@/lib/fulfillment/autoFulfill';
import { expireDirectPayOrders } from '@/lib/directPayExpiry';

export const dynamic = 'force-dynamic';

/** প্রথম রানে কত পিছন পর্যন্ত দেখব (নাহলে পুরনো সব ভঙ্গ একসাথে আসত) */
const FIRST_RUN_LOOKBACK_MS = 24 * 60 * 60 * 1000;
/** এক বার্তায় সর্বোচ্চ কয়টি অর্ডার নাম ধরে বলা হবে */
const MAX_LISTED = 15;
/** ★ OPS-02 — একসাথে একটিই রান; মাঝপথে প্রসেস মরলে এতক্ষণ পরে পরের রান চলে */
const LEASE_TTL_MS = 5 * 60 * 1000;

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

    const r = await runJobExclusive('sla-breach', LEASE_TTL_MS, async () => {
      const now = new Date();
      const prev = await getJobRun('sla-breach');
      // ★ শেষ **সফল** রানের **শুরুর** মুহূর্ত থেকে; না থাকলে ২৪ ঘণ্টা পিছন।
      //   ⚠️ `prev.at` রান **শেষের** সময়, কিন্তু সেই রান ভঙ্গ মেপেছিল তার
      //      শুরুর ঘড়িতে। তাই আগে `at` থেকে ধরলে আগের রান চলাকালীন যে
      //      অর্ডারের ডেডলাইন পেরোত, সেটি কোনো রানেই জানানো হতো না
      //      (EXTREME অডিট ২০২৬-০৯-১৯, রানটাইমে পুনরুৎপাদিত)। `at − ms` = শুরু।
      const since = prev?.ok
        ? new Date(new Date(prev.at).getTime() - (prev.ms ?? 0))
        : new Date(now.getTime() - FIRST_RUN_LOOKBACK_MS);

      /**
       * ★★★ OPS-02 — আগে **সব** খোলা অর্ডার মেমরিতে তুলে গোনা হতো (৫০k+ ব্যাকলগে
       *   প্রতি ১৫ মিনিটে ভারী)। এখন DB-তেই `count`, আর নাম ধরে বলার জন্য কেবল
       *   প্রথম `MAX_LISTED`টি। সীমানা `breachInfo()`-এর হুবহু: সে মিনিট round করে,
       *   তাই "দেরি" = due < now − ৩০s, "শীঘ্রই" = now − ৩০s ≤ due < now + ৩০.৫ মিনিট।
       *   ("নতুন" = নির্ধারিত সময় শেষ রানের পরে পেরিয়েছে — আগের মতোই)
       */
      const OPEN = { in: ['PENDING', 'PROCESSING'] as ('PENDING' | 'PROCESSING')[] };
      const breachedBefore = new Date(now.getTime() - 30_000);
      const soonUntil = new Date(now.getTime() + (SLA_WARN_MIN + 0.5) * 60_000);
      const freshWhere = { status: OPEN, slaDueAt: { gt: since, lt: breachedBefore } };

      const [breached, soon, freshCount, freshRows] = await Promise.all([
        prisma.order.count({ where: { status: OPEN, slaDueAt: { lt: breachedBefore } } }),
        prisma.order.count({ where: { status: OPEN, slaDueAt: { gte: breachedBefore, lt: soonUntil } } }),
        prisma.order.count({ where: freshWhere }),
        prisma.order.findMany({
          where: freshWhere,
          select: { orderNo: true, slaDueAt: true, status: true },
          orderBy: { slaDueAt: 'asc' },
          take: MAX_LISTED,
        }),
      ]);
      const fresh = freshRows.map((o) => ({ orderNo: o.orderNo, label: breachLabel(breachInfo(o, now)) }));

      // ★★★ F1 — মাঝপথে মরে যাওয়া অটো-ডেলিভারি ম্যানুয়াল কিউতে ফেরানো ("ফল অজানা"
      //   নোট ও টেলিগ্রামসহ)। এই ক্রন-ই ১৫ মিনিট অন্তর খোলা অর্ডার দেখে, তাই আলাদা
      //   জব নয় — একই lease-এর ভেতরে, দুটি রান একসাথে ঝাড়ু দেয় না।
      const unstuck = await sweepStuckAutoFulfill();
      // ★★★ F2 — যাচাই-না-হওয়া ডাইরেক্ট-পে অর্ডারের আটকে থাকা স্টক মুক্ত
      //   (ডিপোজিট PENDING-ই থাকে; `lib/directPayExpiry.ts` দেখুন)
      const expired = await expireDirectPayOrders();

      if (freshCount) {
        const listed = fresh
          .map((f) => `• #${f.orderNo} — ${f.label}`).join('\n');
        const more = freshCount > MAX_LISTED
          ? `\n…আরও ${freshCount - MAX_LISTED} টি`
          : '';
        await notifyAdmins(
          `⏰ SLA ভঙ্গ — ${freshCount} টি নতুন`,
          `${listed}${more}\n\nমোট দেরি: ${breached} টি · ${SLA_WARN_MIN} মিনিটের কম বাকি: ${soon} টি`,
          '/admin/orders',
          'sla_breach',
        );
      }

      return {
        result: { checked: breached + soon, breached, soon, notified: freshCount, unstuck, expired },
        detail: (freshCount
          ? `${freshCount} টি নতুন ভঙ্গ জানানো হয়েছে (মোট দেরি ${breached})`
          : `নতুন ভঙ্গ নেই (মোট দেরি ${breached} · শীঘ্রই ${soon})`) +
          (unstuck ? ` · আটকে থাকা অটো-ডেলিভারি ${unstuck} টি কিউতে ফেরত` : '') +
          (expired ? ` · মেয়াদোত্তীর্ণ ডাইরেক্ট-পে ${expired} টি বাতিল` : ''),
      };
    });

    if (r.skipped) return Response.json({ success: true, skipped: true, reason: 'আগের রান এখনো চলছে' });
    if (!r.ok) return Response.json({ success: false, error: r.error, ms: r.ms }, { status: 500 });
    return Response.json({ success: true, ...r.result, ms: r.ms, at: new Date().toISOString() });
  } catch (e) {
    return apiError(e);
  }
}

export const POST = handle;
export const GET = handle;
