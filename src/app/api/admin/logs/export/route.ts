import { prisma } from '@/lib/prisma';
import { requireAdmin, apiError } from '@/lib/guard';
import { buildAuditWhere } from '@/lib/auditFilter';

export const dynamic = 'force-dynamic';

/** ★ অডিট টাইমলাইন → CSV এক্সপোর্ট (একই ফিল্টার যুক্তি)। শুধু অ্যাডমিন। */
function csvCell(v: unknown): string {
  const s = v == null ? '' : String(v);
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
