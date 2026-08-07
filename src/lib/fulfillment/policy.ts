import { getSettings } from '../settings';
import type { PaymentProvider } from '../payments/types';

/**
 * ═══════════════════════════════════════════════════════════
 * ★★★ Fulfillment policy — "ম্যানুয়াল না অটোমেটিক?" সিদ্ধান্ত-স্তর।
 *
 *   ব্যবসায়িক প্রবাহ (ডিপোজিট/অর্ডার/রিফান্ড) এই নীতিকে জিজ্ঞেস করে
 *   "এটি কি অটো-প্রসেস হবে?" — কোনো প্রোভাইডার-নির্দিষ্ট কোড ছাড়াই।
 *
 *   ── অপরিবর্তনীয় নিরাপত্তা-নিয়ম ──
 *   অটো তখনই যখন **দুটোই** সত্য:
 *     ১. অ্যাডমিন config = automatic (নিচের মোড), এবং
 *     ২. একটি প্রোভাইডার সেই সক্ষমতা রাখে **ও** configured।
 *   আজ কোনো gateway configured নয় → প্রতিটি সিদ্ধান্ত 'manual' →
 *   বর্তমান (প্রমাণিত) money-model হুবহু অপরিবর্তিত থাকে। ভবিষ্যতে
 *   gateway যোগ হলে কেবল তখনই অটো-পথ সক্রিয় হবে — কোড না বদলেই।
 * ═══════════════════════════════════════════════════════════
 */

export type FulfillmentMode = 'manual' | 'automatic' | 'hybrid';
export type ApprovalMode = 'manual' | 'automatic';

export type FulfillmentConfig = {
  /** পেমেন্ট নেওয়ার সামগ্রিক ধরন */
  paymentMode: FulfillmentMode;
  /** ডিপোজিট অনুমোদন */
  depositApproval: ApprovalMode;
  /** অর্ডার অনুমোদন/ডেলিভারি */
  orderApproval: ApprovalMode;
  /** রিফান্ড */
  refundMode: ApprovalMode;
};

export const DEFAULT_CONFIG: FulfillmentConfig = {
  paymentMode: 'manual',
  depositApproval: 'manual',
  orderApproval: 'manual',
  refundMode: 'manual',
};

function pick<T extends string>(v: string | undefined, allowed: readonly T[], def: T): T {
  return v && (allowed as readonly string[]).includes(v) ? (v as T) : def;
}

/** সেটিংস থেকে config; অবৈধ/অনুপস্থিত মান নিরাপদে 'manual'-এ পড়ে। */
export async function getFulfillmentConfig(): Promise<FulfillmentConfig> {
  try {
    const s = await getSettings();
    return {
      paymentMode: pick(s.pay_mode, ['manual', 'automatic', 'hybrid'] as const, 'manual'),
      depositApproval: pick(s.deposit_approval, ['manual', 'automatic'] as const, 'manual'),
      orderApproval: pick(s.order_approval, ['manual', 'automatic'] as const, 'manual'),
      refundMode: pick(s.refund_mode, ['manual', 'automatic'] as const, 'manual'),
    };
  } catch {
    return DEFAULT_CONFIG;
  }
}

/** ডিপোজিট: অটো-যাচাই সম্ভব? (config automatic + provider autoVerify + configured) */
export function decideDepositApproval(cfg: FulfillmentConfig, provider?: PaymentProvider): ApprovalMode {
  if (cfg.depositApproval === 'automatic' && provider?.capabilities.autoVerify && provider.isConfigured()) {
    return 'automatic';
  }
  return 'manual';
}

/** অর্ডার: অটো-অনুমোদন/ডেলিভারি? (ডিজিটাল ডেলিভারি প্রোভাইডার-নিরপেক্ষ) */
export function decideOrderApproval(cfg: FulfillmentConfig): ApprovalMode {
  return cfg.orderApproval === 'automatic' ? 'automatic' : 'manual';
}

/** রিফান্ড: প্রোগ্রাম্যাটিক? (config automatic + provider autoRefund + configured) */
export function decideRefund(cfg: FulfillmentConfig, provider?: PaymentProvider): ApprovalMode {
  if (cfg.refundMode === 'automatic' && provider?.capabilities.autoRefund && provider.isConfigured()) {
    return 'automatic';
  }
  return 'manual';
}
