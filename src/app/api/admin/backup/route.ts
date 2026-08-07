import { prisma } from '@/lib/prisma';
import { requireAdmin, apiError } from '@/lib/guard';
import { adminLog } from '@/lib/adminLog';
import { getIp } from '@/lib/rateLimit';
import { computeBackupChecksum, BACKUP_VERSION } from '@/lib/backup';

// ★ সেশন/হেডার পড়ে — বিল্ডের সময় static render করার চেষ্টা করা যাবে না
export const dynamic = 'force-dynamic';

/**
 * ★ পুরো ডাটাবেস ব্যাকআপ — JSON ফাইল হিসেবে ডাউনলোড। শুধু অ্যাডমিন।
 *   ⚠️ H3 fixed — ইউজারের **পাসওয়ার্ড হ্যাশ ব্যাকআপে যায় না**। restore
 *   রুট ইউজার টেবিল ছোঁয়ই না (শুধু কনফিগ/ক্যাটালগ ফেরায়), তাই হ্যাশ বাদ
 *   দিলে কিছু ভাঙে না — কিন্তু একটি admin-ডাউনলোড আর সব ইউজারের bcrypt
 *   হ্যাশ ফাঁস করার (offline cracking) ঝুঁকি থাকে না।
 */
export async function GET(req: Request) {
  try {
    const admin = await requireAdmin();

    const [
      usersRaw, categories, products, variants, banners, socialLinks,
      paymentChannels, coupons, couponUses, deposits, orders,
      ledger, notifications, settings, adminLogs, media, productImages,
    ] = await Promise.all([
      prisma.user.findMany(),
      prisma.category.findMany(),
      prisma.product.findMany(),
      prisma.variant.findMany(),
      prisma.banner.findMany(),
      prisma.socialLink.findMany(),
      prisma.paymentChannel.findMany(),
      prisma.coupon.findMany(),
      prisma.couponUse.findMany(),
      prisma.deposit.findMany(),
      prisma.order.findMany(),
      prisma.ledgerEntry.findMany(),
      prisma.notification.findMany(),
      prisma.setting.findMany(),
      prisma.adminLog.findMany(),
      prisma.media.findMany(),
      prisma.productImage.findMany(),
    ]);

    // ★ H3 — পাসওয়ার্ড হ্যাশ বাদ দিয়ে ইউজার সিরিয়ালাইজ করি।
    //   password: undefined দিলে JSON.stringify কী-টিই বাদ দেয়।
    const users = usersRaw.map((u) => ({ ...u, password: undefined }));

    // ★ ডেটা অংশ (মেটা বাদে) — checksum এর উপর হিসাব হবে
    const dataPart = {
      users, categories, products, variants, banners, socialLinks,
      paymentChannels, coupons, couponUses, deposits, orders,
      ledger, notifications, settings, adminLogs, media, productImages,
    };

    // ★★★ অখণ্ডতা checksum — restore-এ নষ্ট/পরিবর্তিত ফাইল ধরা পড়বে
    const checksum = computeBackupChecksum(dataPart);

    const backup = {
      _meta: {
        app: 'uid-topup',
        version: BACKUP_VERSION,
        exportedAt: new Date().toISOString(),
        exportedBy: admin.name,
        note: 'password hashes excluded (H3)',
        // ★ SHA-256(canonical data) — restore যাচাই করে
        checksum,
      },
      ...dataPart,
    };

    adminLog({
      adminId: admin.id,
      adminName: admin.name,
      action: 'BACKUP_DOWNLOAD',
      ip: getIp(req),
    }).catch(() => {});

    const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
    // ★ Decimal/Date সঠিকভাবে string হবে (JSON.stringify default)
    const json = JSON.stringify(backup, null, 2);

    return new Response(json, {
      headers: {
        'Content-Type': 'application/json; charset=utf-8',
        'Content-Disposition': `attachment; filename="ss-uid-topup-backup-${stamp}.json"`,
        'Cache-Control': 'no-store',
      },
    });
  } catch (e) {
    return apiError(e);
  }
}
