import { prisma } from './prisma';

/**
 * ★ অ্যাডমিন অডিট লগ — কে কখন কী করল।
 *
 *   কেন দরকার: টাকা নিয়ে ঝামেলা হলে (ইউজার বলল "আমার টাকা কাটা হয়েছে
 *   কিন্তু ডায়মন্ড পাইনি") — এখানে দেখা যাবে কোন অ্যাডমিন কখন কী করেছে।
 *   একাধিক অ্যাডমিন থাকলে জবাবদিহি থাকে।
 *
 *   কখনো throw করে না — লগ ফেল করলেও মূল কাজ চলবে।
 */
export type AdminAction =
  | 'DEPOSIT_APPROVE'
  | 'DEPOSIT_REJECT'
  | 'ORDER_PROCESSING'
  | 'ORDER_COMPLETE'
  | 'ORDER_REFUND'
  | 'BALANCE_ADJUST'
  | 'USER_BAN'
  | 'USER_UNBAN'
  | 'PRICE_CHANGE'
  | 'PRODUCT_CREATE'
  | 'PRODUCT_DELETE'
  | 'VARIANT_DELETE'
  | 'COUPON_CREATE'
  | 'COUPON_DELETE'
  | 'SETTINGS_CHANGE'
  | 'BACKUP_DOWNLOAD';

export async function adminLog(opts: {
  adminId: string;
  adminName: string;
  action: AdminAction;
  targetId?: string;
  amount?: number;
  detail?: string;
  ip?: string;
}): Promise<void> {
  try {
    await prisma.adminLog.create({
      data: {
        adminId: opts.adminId,
        adminName: opts.adminName,
        action: opts.action,
        targetId: opts.targetId ?? null,
        amount: opts.amount ?? null,
        detail: opts.detail?.slice(0, 500) ?? null,
        ip: opts.ip ?? null,
      },
    });
  } catch (e) {
    // লগ ফেল করলেও মূল কাজ ভাঙবে না
    console.error('[adminLog] failed:', e);
  }
}
