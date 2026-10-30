import type { Prisma } from '@prisma/client';
import { dhakaRangeFrom, dhakaRangeTo } from './date';

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
  // ★ তারিখ = ঢাকার দিন (`lib/date.ts`); আগে from UTC-মধ্যরাত আর to সার্ভারের ঘড়িতে দিনশেষ
  const from = sp.from ? dhakaRangeFrom(sp.from) : null;
  const to = sp.to ? dhakaRangeTo(sp.to) : null;
  if (from) range.gte = from;
  if (to) range.lte = to;
  if (range.gte || range.lte) and.push({ createdAt: range });
  if (and.length) w.AND = and;
  return w;
}
