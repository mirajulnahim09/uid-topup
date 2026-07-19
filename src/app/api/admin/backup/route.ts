import { prisma } from '@/lib/prisma';
import { requireAdmin, apiError } from '@/lib/guard';
import { adminLog } from '@/lib/adminLog';
import { getIp } from '@/lib/rateLimit';

// ★ সেশন/হেডার পড়ে — বিল্ডের সময় static render করার চেষ্টা করা যাবে না
export const dynamic = 'force-dynamic';

/**
 * ★ পুরো ডাটাবেস ব্যাকআপ — JSON ফাইল হিসেবে ডাউনলোড।
 *   শুধু অ্যাডমিন। ⚠️ ফাইলে পাসওয়ার্ড হ্যাশও থাকে — নিরাপদে রাখুন।
 */
export async function GET(req: Request) {
  try {
    const admin = await requireAdmin();

    const [
      users, categories, products, variants, banners, socialLinks,
      paymentChannels, coupons, couponUses, deposits, orders,
      ledger, notifications, settings, adminLogs,
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
    ]);

    const backup = {
      _meta: {
        app: 'uid-topup',
        version: 2,
        exportedAt: new Date().toISOString(),
        exportedBy: admin.name,
      },
      users, categories, products, variants, banners, socialLinks,
      paymentChannels, coupons, couponUses, deposits, orders,
      ledger, notifications, settings, adminLogs,
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
        'Content-Disposition': `attachment; filename="uidtopup-backup-${stamp}.json"`,
        'Cache-Control': 'no-store',
      },
    });
  } catch (e) {
    return apiError(e);
  }
}
