import type { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { requireAdmin, apiError, ApiError, readJson } from '@/lib/guard';
import { adminLog } from '@/lib/adminLog';
import { getIp } from '@/lib/rateLimit';
import { verifyBackup } from '@/lib/backup';

/**
 * ★ Backup Restore — শুধু কনফিগ/ক্যাটালগ ফিরিয়ে আনে:
 *   settings, categories, products, variants, banners, socialLinks,
 *   paymentChannels, coupons।
 *
 *   ⚠️ নিরাপত্তার জন্য user / order / deposit / ledger ছোঁয়া হয় না
 *      (transactional data overwrite করা বিপজ্জনক)।
 *
 *   সব upsert একটি transaction এ — কোথাও ভুল হলে পুরোটা rollback,
 *   তাই data আধা-corrupt হবে না।
 */
const d = (x: unknown) => (x ? new Date(x as string) : undefined);

export async function POST(req: Request) {
  try {
    const admin = await requireAdmin();
    const payload = await readJson(req);

    // ★ ডবল-নিশ্চিতকরণ
    if (payload?.confirm !== 'RESTORE') {
      throw new ApiError('নিশ্চিত করতে confirm="RESTORE" পাঠান', 400);
    }
    const data = payload?.data;
    if (!data || typeof data !== 'object' || !data._meta) {
      throw new ApiError('অবৈধ ব্যাকআপ ফাইল', 400);
    }

    // ★★★ অখণ্ডতা যাচাই — checksum + version। নষ্ট/পরিবর্তিত/ভুল-সংস্করণ
    //   ফাইল এখানেই থামে, আধা-restore হওয়ার আগে। পুরনো checksum-বিহীন
    //   ব্যাকআপ এখনো চলে (allowUnchecksummed), কিন্তু checksum থাকলে
    //   অবশ্যই মিলতে হবে।
    const verdict = verifyBackup(data, { allowUnchecksummed: true });
    if (!verdict.ok) {
      throw new ApiError(verdict.reason, 400);
    }

    const counts: Record<string, number> = {};

    await prisma.$transaction(
      async (tx: Prisma.TransactionClient) => {
        // 1) settings (key-based)
        for (const s of (data.settings ?? []) as Array<{ key: string; value: string }>) {
          if (!s?.key) continue;
          await tx.setting.upsert({ where: { key: s.key }, create: { key: s.key, value: s.value ?? '' }, update: { value: s.value ?? '' } });
        }
        counts.settings = (data.settings ?? []).length;

        // 2) categories
        for (const c of (data.categories ?? []) as any[]) {
          const v = { name: c.name, slug: c.slug, icon: c.icon ?? null, sortOrder: c.sortOrder ?? 0, isActive: c.isActive ?? true };
          await tx.category.upsert({ where: { id: c.id }, create: { id: c.id, ...v }, update: v });
        }
        counts.categories = (data.categories ?? []).length;

        // 3) products (FK category)
        for (const p of (data.products ?? []) as any[]) {
          const v = {
            categoryId: p.categoryId, name: p.name, slug: p.slug, image: p.image ?? null,
            description: p.description ?? null, needsUid: p.needsUid ?? true, uidLabel: p.uidLabel ?? 'UID',
            uidHint: p.uidHint ?? null, sortOrder: p.sortOrder ?? 0, isActive: p.isActive ?? true,
            createdAt: d(p.createdAt),
          };
          await tx.product.upsert({ where: { id: p.id }, create: { id: p.id, ...v }, update: v });
        }
        counts.products = (data.products ?? []).length;

        // 4) variants (FK product)
        for (const vr of (data.variants ?? []) as any[]) {
          const v = {
            productId: vr.productId, label: vr.label, price: String(vr.price), costPrice: String(vr.costPrice),
            oldPrice: vr.oldPrice != null ? String(vr.oldPrice) : null, stock: vr.stock ?? 0,
            sortOrder: vr.sortOrder ?? 0, isActive: vr.isActive ?? true, isPopular: vr.isPopular ?? false,
          };
          await tx.variant.upsert({ where: { id: vr.id }, create: { id: vr.id, ...v }, update: v });
        }
        counts.variants = (data.variants ?? []).length;

        // 5) banners
        for (const b of (data.banners ?? []) as any[]) {
          const v = { image: b.image, title: b.title ?? null, subtitle: b.subtitle ?? null, link: b.link ?? null, sortOrder: b.sortOrder ?? 0, isActive: b.isActive ?? true, createdAt: d(b.createdAt) };
          await tx.banner.upsert({ where: { id: b.id }, create: { id: b.id, ...v }, update: v });
        }
        counts.banners = (data.banners ?? []).length;

        // 6) socialLinks
        for (const s of (data.socialLinks ?? []) as any[]) {
          const v = { platform: s.platform, url: s.url, label: s.label ?? null, sortOrder: s.sortOrder ?? 0, isActive: s.isActive ?? true };
          await tx.socialLink.upsert({ where: { id: s.id }, create: { id: s.id, ...v }, update: v });
        }
        counts.socialLinks = (data.socialLinks ?? []).length;

        // 7) paymentChannels
        for (const pc of (data.paymentChannels ?? []) as any[]) {
          const v = { method: pc.method, accountNo: pc.accountNo, accountType: pc.accountType, instruction: pc.instruction ?? null, isActive: pc.isActive ?? true, sortOrder: pc.sortOrder ?? 0 };
          await tx.paymentChannel.upsert({ where: { id: pc.id }, create: { id: pc.id, ...v }, update: v });
        }
        counts.paymentChannels = (data.paymentChannels ?? []).length;

        // 8) coupons
        for (const c of (data.coupons ?? []) as any[]) {
          const v = {
            code: c.code, type: c.type, value: String(c.value), minOrder: String(c.minOrder ?? 0),
            maxDiscount: c.maxDiscount != null ? String(c.maxDiscount) : null, usageLimit: c.usageLimit ?? null,
            usageCount: c.usageCount ?? 0, perUserLimit: c.perUserLimit ?? 1, startsAt: d(c.startsAt) ?? new Date(),
            expiresAt: d(c.expiresAt) ?? null, isActive: c.isActive ?? true, createdAt: d(c.createdAt),
          };
          await tx.coupon.upsert({ where: { id: c.id }, create: { id: c.id, ...v }, update: v });
        }
        counts.coupons = (data.coupons ?? []).length;
      },
      { timeout: 60000 }
    );

    adminLog({
      adminId: admin.id, adminName: admin.name, action: 'SETTINGS_CHANGE',
      detail: `ব্যাকআপ restore: ${JSON.stringify(counts)}`, ip: getIp(req),
    }).catch(() => {});

    return Response.json({ success: true, counts });
  } catch (e) {
    return apiError(e);
  }
}
