import { createHash } from 'crypto';
import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { requireAdmin, apiError, ApiError, readJson } from '@/lib/guard';
import { cleanText, safeUrl } from '@/lib/sanitize';
import { adminLog } from '@/lib/adminLog';
import { getIp, rateLimit, LIMITS } from '@/lib/rateLimit';

/**
 * ★ Announcement — সব ইউজারকে একসাথে একটি নোটিফিকেশন পাঠায়।
 *   অ্যাডমিন প্যানেল → টুলস থেকে।
 *
 * ═══════════════════════════════════════════════════════════
 * ★★★ OPS-01 — ব্যাচ, idempotency, সীমা ও নিরাপদ লিংক
 *
 *   আগে: সব ইউজারের id একবারে মেমরিতে, আর একটিই বিশাল `createMany`।
 *   ডাবল-ক্লিক বা নেট কেটে "আবার চাপা" = সবাই দুবার পায়; কোনো সীমা নেই;
 *   লিংক কেবল `cleanText` — `javascript:`/`//evil.com` আটকাত না।
 *
 *   এখন:
 *   · `requestId` (ফর্ম প্রতি ঘোষণায় একটি বানায়) — দাবি-সারি
 *     `Setting["announce:req:<adminId>:<requestId>"]`-এ অগ্রগতি থাকে
 *     (`lastId`, `count`, `done`)। একই চাবি আবার এলে নতুন করে পাঠায় না;
 *     অসমাপ্ত থাকলে যেখানে থেমেছিল সেখান থেকে চালায়। একই চাবি **ভিন্ন
 *     বার্তায়** এলে ৪০৯। (`:` থাকায় সারিটি সাইট-settings-এ ঢোকে না।)
 *   · ব্যাচ: প্রতিবার `BATCH` জন, প্রতিটি নিজের transaction-এ — দাবি-সারি
 *     `FOR UPDATE` লক করে তার `lastId` থেকে পড়া হয়, তাই একই চাবির দুটি
 *     সমান্তরাল অনুরোধও কাউকে দুবার পাঠায় না।
 *   · নতুন ঘোষণায় (নতুন চাবি) প্রতি অ্যাডমিনে `LIMITS.announce`।
 *   · লিংক `safeUrl` — অনিরাপদ হলে ৪০০।
 * ═══════════════════════════════════════════════════════════
 */
const BATCH = 1000;
const REQUEST_ID = /^[A-Za-z0-9_-]{8,64}$/;

type Progress = { h: string; lastId: string; count: number; done: boolean };

export async function POST(req: Request) {
  try {
    const admin = await requireAdmin();

    const raw = await readJson(req);
    const title = cleanText(raw?.title ?? '', 100);
    const body = cleanText(raw?.body ?? '', 500);
    const rawLink = raw?.link ? cleanText(raw.link, 200).trim() : '';
    const requestId = typeof raw?.requestId === 'string' ? raw.requestId : '';

    if (!title.trim()) throw new ApiError('শিরোনাম লিখুন', 400);
    if (!body.trim()) throw new ApiError('বার্তা লিখুন', 400);
    if (!REQUEST_ID.test(requestId)) {
      throw new ApiError('অনুরোধ-চিহ্ন নেই — পাতাটি রিফ্রেশ করে আবার চেষ্টা করুন', 400);
    }
    let link: string | undefined;
    if (rawLink) {
      const safe = safeUrl(rawLink);
      if (!safe) throw new ApiError('লিংকটি নিরাপদ নয় — /path বা https://… দিন', 400);
      link = safe;
    }

    const key = `announce:req:${admin.id}:${requestId}`;
    const h = createHash('sha256').update(`${title}\0${body}\0${link ?? ''}`).digest('hex');

    // ── দাবি: নতুন চাবি হলে সীমা গুনে সারি বানাই; পুরনো হলে সেটিই চালিয়ে যাই ──
    const prior = await prisma.setting.findUnique({ where: { key } });
    if (prior) {
      const st = JSON.parse(prior.value) as Progress;
      if (st.h !== h) throw new ApiError('এই অনুরোধ-চিহ্নে অন্য একটি ঘোষণা আগেই পাঠানো হয়েছে', 409);
    } else {
      if ((await prisma.user.count()) === 0) throw new ApiError('কোনো ইউজার নেই', 400);
      const rl = await rateLimit(`announce:${admin.id}`, LIMITS.announce.limit, LIMITS.announce.window);
      if (!rl.ok) throw new ApiError('অনেক ঘোষণা পাঠানো হয়েছে। একটু পর চেষ্টা করুন।', 429);
      const init: Progress = { h, lastId: '', count: 0, done: false };
      try {
        await prisma.setting.create({ data: { key, value: JSON.stringify(init) } });
      } catch (e) {
        // সমান্তরাল একই চাবি — অন্যটি দাবি নিয়েছে; নিচের লক-করা লুপই দুজনকে ক্রমিক করে
        if (!(e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002')) throw e;
      }
    }

    // ── ব্যাচ-লুপ: প্রতিটি ধাপ দাবি-সারি লক করে তার অগ্রগতি থেকে চলে ──
    let st: Progress;
    let worked = false; // এই অনুরোধ নিজে কাউকে পাঠিয়েছে কি না (নাকি আগেই সম্পূর্ণ ছিল)
    for (;;) {
      st = await prisma.$transaction(async (tx) => {
        const rows = await tx.$queryRaw<Array<{ value: string }>>`
          SELECT value FROM "Setting" WHERE key = ${key} FOR UPDATE`;
        const cur = JSON.parse(rows[0].value) as Progress;
        if (cur.done) return cur;
        worked = true;
        const users = await tx.user.findMany({
          where: cur.lastId ? { id: { gt: cur.lastId } } : {},
          orderBy: { id: 'asc' },
          take: BATCH,
          select: { id: true },
        });
        if (users.length > 0) {
          await tx.notification.createMany({
            data: users.map((u) => ({ userId: u.id, title: `📢 ${title}`, body, link })),
          });
        }
        const next: Progress = {
          h: cur.h,
          lastId: users.length > 0 ? users[users.length - 1].id : cur.lastId,
          count: cur.count + users.length,
          done: users.length < BATCH,
        };
        await tx.setting.update({ where: { key }, data: { value: JSON.stringify(next) } });
        return next;
      });
      if (st.done) break;
    }

    if (worked) {
      adminLog({
        adminId: admin.id,
        adminName: admin.name,
        action: 'SETTINGS_CHANGE',
        detail: `ঘোষণা পাঠানো হয়েছে (${st.count} জন): ${title}`,
        ip: getIp(req),
      }).catch(() => {});
    }

    return Response.json({ success: true, count: st.count, duplicate: !worked });
  } catch (e) {
    return apiError(e);
  }
}
