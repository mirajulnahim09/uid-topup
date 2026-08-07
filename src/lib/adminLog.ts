import { prisma } from './prisma';
import { logger } from './logger';

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
  // ★ প্রোভাইডার ক্রেডেনশিয়াল/মোড/enable — মান নয়, শুধু কোন ফিল্ড বদলাল
  | 'PAYMENT_PROVIDER_CONFIG'
  | 'PRODUCT_UPDATE'
  | 'VARIANT_CREATE'
  | 'VARIANT_UPDATE'
  | 'BANNER_CREATE'
  | 'BANNER_UPDATE'
  | 'BANNER_DELETE'
  // ★ হোমপেজ বিপণন (Option A) — পপআপ/হিরো/স্লাইডার/নোটিশ/প্রচারণা
  | 'CAMPAIGN_CREATE'
  | 'CAMPAIGN_UPDATE'
  | 'CAMPAIGN_DELETE'
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
  | 'ORDER_PARTIAL_REFUND'
  // ── অডিট সম্প্রসারণ: auth ও গ্রাহক/সিস্টেম কার্যক্রম ──
  | 'LOGIN' | 'LOGOUT' | 'REGISTER'
  | 'DEPOSIT_CREATE' | 'ORDER_CREATE'
  | 'MEDIA_UPLOAD' | 'MEDIA_UPDATE' | 'MEDIA_DELETE'
  | 'INTEGRATION_CHANGE'
  // ★ Phase 2 নিরাপত্তা — 2FA ও সেশন revocation
  | 'TWO_FACTOR_ENABLE' | 'TWO_FACTOR_DISABLE' | 'TWO_FACTOR_RECOVERY_USED'
  | 'SESSION_REVOKE_ALL';

/** কে কাজটি করল — ভূমিকা নয়, শ্রেণি */
export type ActorType = 'ADMIN' | 'CUSTOMER' | 'SYSTEM';

/**
 * ★★★ সাধারণ অ্যাক্টিভিটি লগ — ADMIN / CUSTOMER / SYSTEM সবার জন্য।
 *   একই AdminLog টেবিলে লেখে (কোনো ডুপ্লিকেট স্তর নয়); actorType/role/
 *   userAgent সহ। কখনো throw করে না — লগ ফেল করলেও মূল কাজ চলবে।
 */
export async function logActivity(opts: {
  actorId: string;
  actorName: string;
  actorType: ActorType;
  role?: string | null;
  action: AdminAction;
  targetId?: string;
  amount?: number;
  detail?: string;
  ip?: string;
  userAgent?: string;
}): Promise<void> {
  try {
    await prisma.adminLog.create({
      data: {
        adminId: opts.actorId,
        adminName: opts.actorName,
        actorType: opts.actorType,
        role: opts.role ?? null,
        action: opts.action,
        targetId: opts.targetId ?? null,
        amount: opts.amount ?? null,
        detail: opts.detail?.slice(0, 500) ?? null,
        ip: opts.ip ?? null,
        userAgent: opts.userAgent?.slice(0, 300) ?? null,
      },
    });
  } catch (e) {
    logger.error('adminLog', 'failed', { err: e });
  }
}

/** অ্যাডমিন-কর্মের সুবিধাজনক wrapper (পুরনো সব কল-সাইট অপরিবর্তিত)। */
export async function adminLog(opts: {
  adminId: string;
  adminName: string;
  action: AdminAction;
  targetId?: string;
  amount?: number;
  detail?: string;
  ip?: string;
  userAgent?: string;
}): Promise<void> {
  return logActivity({
    actorId: opts.adminId,
    actorName: opts.adminName,
    actorType: 'ADMIN',
    role: 'ADMIN',
    action: opts.action,
    targetId: opts.targetId,
    amount: opts.amount,
    detail: opts.detail,
    ip: opts.ip,
    userAgent: opts.userAgent,
  });
}

/** Request থেকে IP + userAgent — লগে device/আইপি রাখতে */
export function requestMeta(req: Request): { ip: string; userAgent: string } {
  const h = req.headers;
  const ip =
    h.get('x-real-ip') || h.get('cf-connecting-ip') ||
    h.get('x-forwarded-for')?.split(',')[0].trim() || 'unknown';
  return { ip, userAgent: h.get('user-agent') || '' };
}
