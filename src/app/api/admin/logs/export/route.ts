import { prisma } from '@/lib/prisma';
import { requireAdmin, apiError } from '@/lib/guard';
import { buildAuditWhere } from '@/lib/auditFilter';

export const dynamic = 'force-dynamic';

/**
 * ★ অডিট টাইমলাইন → CSV এক্সপোর্ট (একই ফিল্টার যুক্তি)। শুধু অ্যাডমিন।
 *
 * ★★★ Formula-injection গার্ড। কোটে মোড়ানো যথেষ্ট নয় — Excel/Sheets
 *   `"=…"` সেলকেও সূত্র হিসেবে চালায়। এই লগে গ্রাহকের নিয়ন্ত্রিত মান
 *   যায়: `userAgent` (কাঁচা হেডার, যেমন `=HYPERLINK("https://…",…)`),
 *   নাম ও বিবরণ। মালিক এক্সপোর্ট খুললেই সূত্রটি চলত। `reports/route.ts`
 *   এ গার্ডটি আগেই ছিল; এখানে ছিল না।
 *   ⚠️ শুদ্ধ সংখ্যা (যেমন ঋণাত্মক অঙ্ক `-50`) ছাড় পায় — সেটি সূত্র নয়,
 *   আর আগে `'` বসালে Excel সংখ্যাটিকে লেখা ধরে যোগফল ভেঙে দিত।
 */
function csvCell(v: unknown): string {
  let s = v == null ? '' : String(v);
  if (/^[=+\-@\t\r]/.test(s) && !/^-?\d+(\.\d+)?$/.test(s)) s = `'${s}`;
  return `"${s.replace(/"/g, '""').replace(/[\r\n]+/g, ' ')}"`;
}

export async function GET(req: Request) {
  try {
    await requireAdmin();
    const u = new URL(req.url);
    const where = buildAuditWhere({
      q: u.searchParams.get('q') || undefined,
      actor: u.searchParams.get('actor') || undefined,
      action: u.searchParams.get('action') || undefined,
      from: u.searchParams.get('from') || undefined,
      to: u.searchParams.get('to') || undefined,
    });

    const logs = await prisma.adminLog.findMany({ where, orderBy: { createdAt: 'desc' }, take: 10000 });

    const header = ['createdAt', 'actorType', 'actorName', 'role', 'action', 'amount', 'targetId', 'detail', 'ip', 'userAgent'];
    const rows = logs.map((l) => [
      l.createdAt.toISOString(), l.actorType, l.adminName, l.role ?? '', l.action,
      l.amount != null ? String(l.amount) : '', l.targetId ?? '', l.detail ?? '', l.ip ?? '', l.userAgent ?? '',
    ]);
    const csv = [header, ...rows].map((r) => r.map(csvCell).join(',')).join('\r\n');
    // ★ BOM যাতে Excel-এ বাংলা ইউনিকোড ঠিক দেখায়
    const body = '﻿' + csv;

    return new Response(body, {
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="activity-log-${new Date().toISOString().slice(0, 10)}.csv"`,
        'Cache-Control': 'no-store',
      },
    });
  } catch (e) {
    return apiError(e);
  }
}
