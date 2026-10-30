import type { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { requireAdmin, apiError, ApiError, readJson } from '@/lib/guard';
import { adminLog } from '@/lib/adminLog';
import { getIp } from '@/lib/rateLimit';
import { verifyBackup } from '@/lib/backup';
import { normalizeSettingValue } from '@/lib/settingsPolicy';
import { invalidateSettings } from '@/lib/settings';

/**
 * ★ Backup Restore — শুধু কনফিগ/ক্যাটালগ ফিরিয়ে আনে:
 *   settings (কেবল অনুমোদিত কী), categories, products, variants, banners,
 *   socialLinks, coupons (ব্যবহার-গণনা বাদে), আর paymentChannels **কেবল**
 *   `includePaymentChannels: true` দিলে (BKP-01)। স্বাক্ষরহীন ফাইল প্রত্যাখ্যাত।
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

    // ★★★ অখণ্ডতা + **উৎস** যাচাই — HMAC স্বাক্ষর + checksum + version।
    //   BKP-01: আগে checksum-বিহীন ফাইলও চলত (allowUnchecksummed), আর checksum
    //   গোপন-চাবিহীন হওয়ায় সম্পাদিত ফাইলে নতুন checksum বসালেই পাস করত।
    //   এখন কেবল **এই সার্ভারের স্বাক্ষর করা** ব্যাকআপ restore হয়।
    const verdict = verifyBackup(data);
    if (!verdict.ok) {
      throw new ApiError(verdict.reason, 400);
    }

    // ★★★ BKP-01 — পেমেন্ট নাম্বার (bKash/Nagad) সবচেয়ে সংবেদনশীল মান: ভুল
    //   নাম্বারে পাঠানো গ্রাহকের টাকা ফেরানো যায় না। তাই ডিফল্টে restore করা
    //   **হয় না**; কেবল অনুরোধে স্পষ্ট `includePaymentChannels: true` থাকলে।
    const includePaymentChannels = payload?.includePaymentChannels === true;

    const counts: Record<string, number> = {};
    const skippedSettings: string[] = [];

    await prisma.$transaction(
      async (tx: Prisma.TransactionClient) => {
        // 1) settings (key-based)
        // ★★★ BKP-01 — `/api/admin/settings`-এর হুবহু একই allowlist ও মান-যাচাই।
        //   আগে ফাইলের যেকোনো কী যেকোনো মানে লেখা হতো (withdrawal_*,
        //   maintenance_mode, pp_* ক্রেডেনশিয়াল, job_lastrun_*, webhook মার্কার)।
        //   অনুমোদনহীন কী বাদ পড়ে ও তালিকায় জানানো হয়; অনুমোদিত কী-তে অবৈধ মান
        //   হলে ApiError → পুরো restore rollback (সাজানো ফাইলের লক্ষণ)।
        let settingsWritten = 0;
        for (const s of (data.settings ?? []) as Array<{ key: string; value: string }>) {
          if (!s?.key || typeof s.key !== 'string') continue;
          const value = normalizeSettingValue(s.key, s.value);
          if (value === null) { skippedSettings.push(s.key); continue; }
          await tx.setting.upsert({ where: { key: s.key }, create: { key: s.key, value }, update: { value } });
          settingsWritten++;
        }
        counts.settings = settingsWritten;

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
        // ★★★ D2-1 — `stock` **কখনো বিদ্যমান ভ্যারিয়েন্টে ফাইল থেকে নয়** (কুপনের
        //   `usageCount`-এর BKP-01 নিয়মের হুবহু একই কারণ)। মাপা: ব্যাকআপে ১০০, বিক্রি
        //   হয়ে লাইভে ৪০ — একটি ব্যানার ফেরাতে restore করলেই স্টক ১০০ হয়ে যেত, আর
        //   যে ৬০টি নেই সেগুলোও বিক্রি হতো (প্রতিটি পরে রিফান্ড, সীমিত কোডে আসল ক্ষতি)।
        //   লাইভ স্টক অর্ডার-পথের লক করা রো-ই ঠিক করে; restore তা জানে না। কেবল নতুন
        //   করে তৈরি (মুছে যাওয়া) ভ্যারিয়েন্ট ফাইলের স্টক নেয় — তুলনার আর কিছু নেই।
        for (const vr of (data.variants ?? []) as any[]) {
          const v = {
            productId: vr.productId, label: vr.label, price: String(vr.price), costPrice: String(vr.costPrice),
            oldPrice: vr.oldPrice != null ? String(vr.oldPrice) : null,
            sortOrder: vr.sortOrder ?? 0, isActive: vr.isActive ?? true, isPopular: vr.isPopular ?? false,
          };
          await tx.variant.upsert({
            where: { id: vr.id },
            create: { id: vr.id, ...v, stock: vr.stock ?? 0 },
            update: v,
          });
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

        // 7) paymentChannels — ★ BKP-01: কেবল স্পষ্ট অনুমতিতে (উপরে ব্যাখ্যা)
        if (includePaymentChannels) {
          for (const pc of (data.paymentChannels ?? []) as any[]) {
            const v = { method: pc.method, accountNo: pc.accountNo, accountType: pc.accountType, instruction: pc.instruction ?? null, isActive: pc.isActive ?? true, sortOrder: pc.sortOrder ?? 0 };
            await tx.paymentChannel.upsert({ where: { id: pc.id }, create: { id: pc.id, ...v }, update: v });
          }
          counts.paymentChannels = (data.paymentChannels ?? []).length;
        } else {
          counts.paymentChannels = 0;
        }

        // 8) coupons
        // ★★★ BKP-01 — `usageCount` **কখনো ফাইল থেকে নয়**। পুরনো ব্যাকআপের কম
        //   গণনা বসালে ব্যবহার-সীমা শেষ হওয়া কুপন আবার চালু হতো (ছাড়ের টাকা ফাঁস)।
        //   বিদ্যমান কুপনে গণনা অপরিবর্তিত; নতুন করে তৈরি হলে প্রকৃত `CouponUse`
        //   সারি গুনে বসে — অর্থাৎ সবসময় বাস্তব ব্যবহারের সমান।
        for (const c of (data.coupons ?? []) as any[]) {
          const v = {
            code: c.code, type: c.type, value: String(c.value), minOrder: String(c.minOrder ?? 0),
            maxDiscount: c.maxDiscount != null ? String(c.maxDiscount) : null, usageLimit: c.usageLimit ?? null,
            perUserLimit: c.perUserLimit ?? 1, startsAt: d(c.startsAt) ?? new Date(),
            expiresAt: d(c.expiresAt) ?? null, isActive: c.isActive ?? true, createdAt: d(c.createdAt),
          };
          const realUses = await tx.couponUse.count({ where: { couponId: c.id } });
          await tx.coupon.upsert({ where: { id: c.id }, create: { id: c.id, ...v, usageCount: realUses }, update: v });
        }
        counts.coupons = (data.coupons ?? []).length;
      },
      { timeout: 60000 }
    );

    // ★ BKP-01 — সেটিংস ক্যাশ বাতিল; নাহলে এই ইনস্ট্যান্স ৩০ সেকেন্ড পুরনো মান দেখাত
    invalidateSettings();

    adminLog({
      adminId: admin.id, adminName: admin.name, action: 'SETTINGS_CHANGE',
      detail: `ব্যাকআপ restore: ${JSON.stringify(counts)}`
        + (includePaymentChannels ? ' · পেমেন্ট নাম্বারও' : ' · পেমেন্ট নাম্বার বাদ')
        + (skippedSettings.length ? ` · বাদ পড়া সেটিং ${skippedSettings.length}টি` : ''),
      ip: getIp(req),
    }).catch(() => {});

    return Response.json({
      success: true,
      counts,
      paymentChannelsRestored: includePaymentChannels,
      skippedSettings,
    });
  } catch (e) {
    return apiError(e);
  }
}
