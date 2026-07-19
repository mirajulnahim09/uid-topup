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
  | 'COUPON_UPDATE'
  | 'COUPON_DELETE'
  | 'SETTINGS_CHANGE'
  | 'BACKUP_DOWNLOAD'
  // ★★★ পেমেন্ট নাম্বার — পুরো অ্যাডমিন প্যানেলের সবচেয়ে ঝুঁকিপূর্ণ
  //     পরিবর্তন। নাম্বার বদলে দিলে **সব গ্রাহকের টাকা অন্য কোথাও
  //     চলে যাবে**। তাই এটি অবশ্যই লগ হতে হবে (3.3)।
  | 'PAYMENT_CREATE'
  | 'PAYMENT_UPDATE'
  | 'PAYMENT_DELETE'
  | 'PRODUCT_UPDATE'
  | 'VARIANT_CREATE'
  | 'VARIANT_UPDATE'
  | 'BANNER_CREATE'
  | 'BANNER_UPDATE'
  | 'BANNER_DELETE'
  | 'SOCIAL_CREATE'
  | 'SOCIAL_UPDATE'
  | 'SOCIAL_DELETE'
  // ★ ফুলফিলমেন্ট claim (3.7) — TAKEOVER আলাদা করে রাখা জরুরি:
  //   "আমি কাজ করছিলাম, কেউ কেড়ে নিয়ে দুবার ডেলিভারি দিয়েছে"
  //   — এই বিরোধ মেটানোর একমাত্র প্রমাণ এটি।
  | 'ORDER_CLAIM'
  | 'ORDER_RELEASE'
  | 'ORDER_TAKEOVER'
  // ★ আংশিক রিফান্ড (3.14) — পূর্ণ রিফান্ড থেকে আলাদা রাখা জরুরি,
  //   কারণ দুটোর ব্যবসায়িক অর্থ আলাদা এবং বিরোধে প্রশ্নও আলাদা
  | 'ORDER_PARTIAL_REFUND';

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
