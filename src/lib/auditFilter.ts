import type { Prisma } from '@prisma/client';

/** ★ অডিট টাইমলাইন ফিল্টার — page ও CSV export একই যুক্তি ব্যবহার করে (DRY)। */
export type AuditFilter = { q?: string; actor?: string; action?: string; from?: string; to?: string };

export function buildAuditWhere(sp: AuditFilter): Prisma.AdminLogWhereInput {
  const w: Prisma.AdminLogWhereInput = {};
  const and: Prisma.AdminLogWhereInput[] = [];
  if (sp.actor && ['ADMIN', 'CUSTOMER', 'SYSTEM'].includes(sp.actor)) and.push({ actorType: sp.actor });
  if (sp.action) and.push({ action: sp.action });
  if (sp.q) and.push({ OR: [
    { adminName: { contains: sp.q, mode: 'insensitive' } },
    { detail: { contains: sp.q, mode: 'insensitive' } },
    { targetId: { contains: sp.q, mode: 'insensitive' } },
    { ip: { contains: sp.q, mode: 'insensitive' } },
  ] });
  const range: Prisma.DateTimeFilter = {};
  if (sp.from && !Number.isNaN(Date.parse(sp.from))) range.gte = new Date(sp.from);
  if (sp.to && !Number.isNaN(Date.parse(sp.to))) { const d = new Date(sp.to); d.setHours(23, 59, 59, 999); range.lte = d; }
  if (range.gte || range.lte) and.push({ createdAt: range });
  if (and.length) w.AND = and;
  return w;
}
