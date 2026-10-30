import { prisma } from '@/lib/prisma';
import { requireAdmin, apiError, ApiError } from '@/lib/guard';
import { dhakaDayStart, dhakaRangeFrom, dhakaRangeTo } from '@/lib/date';

// ★ সেশন/হেডার পড়ে — বিল্ডের সময় static render করার চেষ্টা করা যাবে না
export const dynamic = 'force-dynamic';

/** ★ CSV এর জন্য নিরাপদ সেল — কমা/কোট/newline ঠিক করে, formula-injection আটকায় */
function cell(v: unknown): string {
  let s = v == null ? '' : String(v);
  // Excel formula injection guard
  if (/^[=+\-@]/.test(s)) s = "'" + s;
  if (/[",\n\r]/.test(s)) s = '"' + s.replace(/"/g, '""') + '"';
  return s;
}

/**
 * ★★★ CSV **স্ট্রিম** করে পাঠানো — ২০০০ সারির ব্যাচে।
 *
 *   ⚠️ মাপা (সিমুলেশন, ২০২৬-০৯-২৫): আগে পুরো রিপোর্ট মেমরিতে একটি স্ট্রিং
 *   হয়ে তারপর যেত। ~৫০ হাজার অর্ডারে ৬.২MB/৩s, ৫ লাখে ৪৬MB/২৭s। Vercel-এর
 *   সাধারণ (non-streaming) ফাংশন-উত্তরের সীমা ৪.৫MB — অর্থাৎ ব্যস্ত মাসে
 *   ডিফল্ট ৩০-দিনের রিপোর্ট প্রোডাকশনে ডাউনলোডই হতো না।
 *
 *   ⚠️ কেন Prisma-র `cursor` পাতা নয়: প্রথম সংস্করণে সেটিই ছিল, আর প্রতিটি
 *   ব্যাচে পুরো টেবিল স্ক্যান হতো (`Order.createdAt`-এ একক সূচি নেই) —
 *   ৫ লাখে মোট সময় ২৭s → **৭৫s** হয়ে গিয়েছিল। এখন: প্রথমে একবারই কেবল
 *   `id`-গুলো সাজানো ক্রমে (এক স্ক্যান), তারপর প্রতিটি ব্যাচ primary key দিয়ে।
 */
const BATCH = 2000;

function streamCsv<T extends { id: string }>(
  headers: string[],
  fetchIds: () => Promise<string[]>,
  fetchRows: (ids: string[]) => Promise<T[]>,
  toRow: (r: T) => unknown[],
): ReadableStream<Uint8Array> {
  const enc = new TextEncoder();
  let ids: string[] | null = null;
  let at = 0;
  return new ReadableStream<Uint8Array>({
    async pull(ctrl) {
      if (ids === null) {
        ids = await fetchIds();
        // ★ BOM — Excel এ বাংলা ঠিক দেখাবে
        ctrl.enqueue(enc.encode('﻿' + headers.map(cell).join(',')));
        if (ids.length === 0) ctrl.close();
        return;
      }
      const chunk = ids.slice(at, at + BATCH);
      at += BATCH;
      // ★ `IN (...)` ক্রম রাখে না — id-তালিকার ক্রমে ফিরিয়ে সাজানো
      const byId = new Map((await fetchRows(chunk)).map((r) => [r.id, r]));
      const lines = chunk.map((id) => byId.get(id)).filter((r): r is T => !!r);
      if (lines.length) ctrl.enqueue(enc.encode(lines.map((r) => '\r\n' + toRow(r).map(cell).join(',')).join('')));
      if (at >= ids.length) ctrl.close();
    },
  });
}

export async function GET(req: Request) {
  try {
    await requireAdmin();

    const url = new URL(req.url);
    const type = url.searchParams.get('type') || 'orders';
    const fromStr = url.searchParams.get('from');
    const toStr = url.searchParams.get('to');

    // ★ 'YYYY-MM-DD' = ঢাকার সেই দিনের শুরু/শেষ (`lib/date.ts`)। আগে
    //   `new Date('2026-09-14')` UTC-মধ্যরাত (= ঢাকার সকাল ৬টা) ধরত, আর
    //   `setHours(23,59)` সার্ভারের ঘড়িতে — রিপোর্টে দিনের প্রথম ৬ ঘণ্টা বাদ
    //   পড়ত ও Vercel-এ পরের দিনের ৬ ঘণ্টা ঢুকত (মাপা: timezone-boundary.ts)।
    const from = fromStr ? dhakaRangeFrom(fromStr) : new Date(Date.now() - 30 * 864e5);
    const to = toStr ? dhakaRangeTo(toStr) : new Date(dhakaDayStart(new Date(), 1).getTime() - 1);

    if (!from || !to) {
      throw new ApiError('সঠিক তারিখ দিন', 400);
    }

    let body: ReadableStream<Uint8Array>;
    let name = '';
    const order = [{ createdAt: 'desc' as const }, { id: 'desc' as const }];

    if (type === 'deposits') {
      body = streamCsv(
        ['রিচার্জ নং', 'নাম', 'ফোন', 'মেথড', 'পরিমাণ', 'TrxID', 'প্রেরক নং', 'স্ট্যাটাস', 'তারিখ'],
        () => prisma.deposit.findMany({
          where: { createdAt: { gte: from, lte: to } },
          orderBy: order, select: { id: true },
        }).then((r) => r.map((x) => x.id)),
        (ids) => prisma.deposit.findMany({
          where: { id: { in: ids } },
          include: { user: { select: { name: true, phone: true } } },
        }),
        (d) => [
          d.depositNo, d.user.name, d.user.phone, d.method, Number(d.amount),
          d.trxId, d.senderNo, d.status, d.createdAt.toISOString(),
        ],
      );
      name = 'recharge';
    } else if (type === 'users') {
      body = streamCsv(
        ['নাম', 'ইমেইল', 'ফোন', 'ব্যালেন্স', 'ব্যান', 'যোগদান'],
        () => prisma.user.findMany({
          where: { role: 'USER', createdAt: { gte: from, lte: to } },
          orderBy: order, select: { id: true },
        }).then((r) => r.map((x) => x.id)),
        (ids) => prisma.user.findMany({
          where: { id: { in: ids } },
          select: { id: true, name: true, email: true, phone: true, balance: true, isBanned: true, createdAt: true },
        }),
        (u) => [
          u.name, u.email, u.phone, Number(u.balance), u.isBanned ? 'হ্যাঁ' : 'না',
          u.createdAt.toISOString(),
        ],
      );
      name = 'users';
    } else {
      // orders (default)
      body = streamCsv(
        ['অর্ডার নং', 'নাম', 'ফোন', 'প্রোডাক্ট', 'প্যাকেজ', 'UID', 'মূল্য', 'ছাড়', 'স্ট্যাটাস', 'তারিখ'],
        () => prisma.order.findMany({
          where: { createdAt: { gte: from, lte: to } },
          orderBy: order, select: { id: true },
        }).then((r) => r.map((x) => x.id)),
        (ids) => prisma.order.findMany({
          where: { id: { in: ids } },
          include: { user: { select: { name: true, phone: true } } },
        }),
        (o) => [
          o.orderNo, o.user.name, o.user.phone, o.productName, o.variantName,
          o.playerUid, Number(o.price), Number(o.discount), o.status, o.createdAt.toISOString(),
        ],
      );
      name = 'orders';
    }

    const stamp = new Date().toISOString().slice(0, 10);
    return new Response(body, {
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="${name}-${stamp}.csv"`,
        'Cache-Control': 'no-store',
      },
    });
  } catch (e) {
    return apiError(e);
  }
}
