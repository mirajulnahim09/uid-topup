import { prisma } from '@/lib/prisma';
import { requireAdmin, apiError, ApiError } from '@/lib/guard';

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

function toCsv(headers: string[], rows: unknown[][]): string {
  const lines = [headers.map(cell).join(',')];
  for (const r of rows) lines.push(r.map(cell).join(','));
  // ★ BOM — Excel এ বাংলা ঠিক দেখাবে
  return '\uFEFF' + lines.join('\r\n');
}

export async function GET(req: Request) {
  try {
    await requireAdmin();

    const url = new URL(req.url);
    const type = url.searchParams.get('type') || 'orders';
    const fromStr = url.searchParams.get('from');
    const toStr = url.searchParams.get('to');

    const from = fromStr ? new Date(fromStr) : new Date(Date.now() - 30 * 864e5);
    const to = toStr ? new Date(toStr) : new Date();
    to.setHours(23, 59, 59, 999);

    if (isNaN(from.getTime()) || isNaN(to.getTime())) {
      throw new ApiError('সঠিক তারিখ দিন', 400);
    }

    let csv = '';
    let name = '';

    if (type === 'deposits') {
      const rows = await prisma.deposit.findMany({
        where: { createdAt: { gte: from, lte: to } },
        orderBy: { createdAt: 'desc' },
        include: { user: { select: { name: true, phone: true } } },
      });
      csv = toCsv(
        ['রিচার্জ নং', 'নাম', 'ফোন', 'মেথড', 'পরিমাণ', 'TrxID', 'প্রেরক নং', 'স্ট্যাটাস', 'তারিখ'],
        rows.map((d: (typeof rows)[number]) => [
          d.depositNo, d.user.name, d.user.phone, d.method, Number(d.amount),
          d.trxId, d.senderNo, d.status, d.createdAt.toISOString(),
        ])
      );
      name = 'recharge';
    } else if (type === 'users') {
      const rows = await prisma.user.findMany({
        where: { role: 'USER', createdAt: { gte: from, lte: to } },
        orderBy: { createdAt: 'desc' },
        select: { name: true, email: true, phone: true, balance: true, isBanned: true, createdAt: true },
      });
      csv = toCsv(
        ['নাম', 'ইমেইল', 'ফোন', 'ব্যালেন্স', 'ব্যান', 'যোগদান'],
        rows.map((u: (typeof rows)[number]) => [
          u.name, u.email, u.phone, Number(u.balance), u.isBanned ? 'হ্যাঁ' : 'না',
          u.createdAt.toISOString(),
        ])
      );
      name = 'users';
    } else {
      // orders (default)
      const rows = await prisma.order.findMany({
        where: { createdAt: { gte: from, lte: to } },
        orderBy: { createdAt: 'desc' },
        include: { user: { select: { name: true, phone: true } } },
      });
      csv = toCsv(
        ['অর্ডার নং', 'নাম', 'ফোন', 'প্রোডাক্ট', 'প্যাকেজ', 'UID', 'মূল্য', 'ছাড়', 'স্ট্যাটাস', 'তারিখ'],
        rows.map((o: (typeof rows)[number]) => [
          o.orderNo, o.user.name, o.user.phone, o.productName, o.variantName,
          o.playerUid, Number(o.price), Number(o.discount), o.status, o.createdAt.toISOString(),
        ])
      );
      name = 'orders';
    }

    const stamp = new Date().toISOString().slice(0, 10);
    return new Response(csv, {
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
