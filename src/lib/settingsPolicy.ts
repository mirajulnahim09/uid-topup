import { ApiError } from './guard';
import { cleanText, safeUrl } from './sanitize';

/**
 * ═══════════════════════════════════════════════════════════
 * ★★★ কোন সেটিং-কী লেখা যাবে ও মান কীভাবে যাচাই হবে — **একক উৎস**
 *
 *   আগে এই নিয়ম কেবল `/api/admin/settings` রুটের ভেতরে ছিল, আর backup
 *   restore (`/api/admin/restore`) ফাইলের **যেকোনো** কী যেকোনো মানে লিখত —
 *   অর্থাৎ restore দিয়ে allowlist ও মান-যাচাই দুটোই পাশ কাটানো যেত (BKP-01)।
 *   এখন দুই পথই এই একই ফাংশন ডাকে; নিয়ম একবার বদলালে দুই জায়গায় কার্যকর।
 *
 *   ⚠️ তালিকা ও নিয়ম হুবহু আগের settings-রুটের — কোনো কী যোগ/বাদ হয়নি।
 * ═══════════════════════════════════════════════════════════
 */

// ★ শুধু এই key গুলো লেখা যাবে — arbitrary key নয়
//
// ⚠️ হোমপেজ বিপণন কনফিগ (Option A, additive): নিচের `home_*` ও
//    `float_*` কী-গুলো যোগ করা হয়েছে যাতে লাইভ-অ্যাক্টিভিটি ফিড,
//    বিশ্বাস-পরিসংখ্যান, বিশ্বাস-স্ট্রিপ ও ভাসমান-যোগাযোগ বোতাম
//    অ্যাডমিন থেকে চালু/বন্ধ ও কনফিগার করা যায়। রিচ কনটেন্ট
//    (পপআপ/হিরো/স্লাইডার/নোটিশ) আলাদা `Campaign` মডেলে থাকে;
//    এখানে কেবল টগল ও ছোট কনফিগ। কোনো বিদ্যমান key সরানো হয়নি।
export const SETTINGS_ALLOWED = new Set([
  'site_name', 'site_logo', 'site_notice',
  'hero_title', 'hero_subtitle',
  'min_deposit', 'max_deposit',
  'referral_bonus', 'referral_min_deposit',
  'support_email', 'support_phone', 'support_hours',
  'maintenance_mode', 'maintenance_message',
  // ── হোমপেজ বিপণন কনফিগ ──
  'home_live_activity',        // "1"/"0" — সাম্প্রতিক ডেলিভারি ফিড দেখানো
  'home_live_activity_count',  // সংখ্যা — কতটি সাম্প্রতিক অর্ডার
  'home_trust_stats',          // "1"/"0" — প্রকৃত পরিসংখ্যান দেখানো
  'home_trust_strip',          // "1"/"0" — হিরোর নিচে বিশ্বাস-স্ট্রিপ
  'float_contact_type',        // "whatsapp"/"telegram"/"" — ভাসমান বোতাম
  'float_contact_value',       // লিংক (wa.me / t.me)
  // ── লাইভ চ্যাট (Tawk.to) — খালি রাখলে উইজেট লোড হয় না ──
  'tawk_property_id',          // tawk.to property id
  'tawk_widget_id',            // tawk.to widget id
  // ── টেলিগ্রাম বট (ফিচার ৯) — অপারেটর নোটিফিকেশন ──
  'telegram_bot_token',        // BotFather টোকেন
  'telegram_chat_id',          // যে চ্যাট/গ্রুপে মেসেজ যাবে
  'site_url',                  // পূর্ণ URL (টেলিগ্রাম লিংকের জন্য), যেমন https://uidtopup.com
  // ── ফুলফিলমেন্ট মোড (পেমেন্ট আর্কিটেকচার) — নীতি-স্তর এগুলো পড়ে ──
  //   অবৈধ মান নিরাপদে 'manual'-এ পড়ে (policy.ts)। gateway configured
  //   না থাকলে automatic দিলেও আচরণ manual-ই থাকে (নিরাপত্তা-নিয়ম)।
  'pay_mode',                  // manual | automatic | hybrid
  'deposit_approval',          // manual | automatic
  'order_approval',            // manual | automatic
  'refund_mode',               // manual | automatic
  // ── প্রোভাইডার চালু/বন্ধ ("1"/"0") — registry এগুলো পড়ে ──
  'provider_manual_enabled', 'provider_bkash_enabled', 'provider_nagad_enabled',
  'provider_rocket_enabled', 'provider_sslcommerz_enabled', 'provider_stripe_enabled',
  'provider_paypal_enabled', 'provider_razorpay_enabled',
  // ── Feature Flags (Enterprise) — ফিচার on/off, deploy ছাড়া ──
  //   featureFlags.ts এগুলো পড়ে ("1"/"0")। শুধু UI/অ-আর্থিক ফিচার।
  'flag_live_activity', 'flag_reviews', 'flag_referral',
  'flag_review_photos', 'flag_rating_badges',
  /**
   * ── টাকা তোলার কনফিগ (স্বাধীন অডিট, ২০২৬-০৯-১৮ · মালিকের সিদ্ধান্ত) ──
   *   `/admin/withdrawals` পাতা বলত "সেটিংসে `withdrawal_enabled` = 1 দিন", অথচ
   *   কী-গুলো এই তালিকায় **ছিল না** — অর্থাৎ অ্যাডমিন প্যানেল থেকে ফিচারটি
   *   চালুই করা যেত না, কেবল DB-তে হাতে সারি বসিয়ে। এখন অ্যাডমিন-অনুমোদিত
   *   পথেই বদলানো যায় (সংখ্যাগুলো NUM_KEYS-এ যাচাই হয়)।
   */
  'withdrawal_enabled', 'withdrawal_min', 'withdrawal_daily_cap',
  'withdrawal_hold_hours', 'withdrawal_methods',
  // ── storefront extras: tutorial, about, community, Android app ──
  'tutorial_video_url',        // YouTube link for the "how to order" video
  'about_text',                // About Us page body (plain text, blank lines = paragraphs)
  'community_url',             // Telegram/WhatsApp group or channel link
  'community_label',           // e.g. "টেলিগ্রাম গ্রুপ"
  'android_app_url',           // Play Store link (shows "Install app")
  'twa_package',               // Android package name for assetlinks.json
  'twa_sha256',                // signing-cert SHA-256 fingerprint(s), comma separated
]);

const URL_KEYS = new Set(['site_logo', 'float_contact_value', 'site_url', 'tutorial_video_url', 'community_url', 'android_app_url']);
const NUM_KEYS = new Set([
  'min_deposit', 'max_deposit', 'referral_bonus', 'referral_min_deposit',
  'home_live_activity_count',
  // ★ টাকা তোলার সীমা — ঋণাত্মক/অসংখ্যা মান ঢুকতে পারবে না
  'withdrawal_min', 'withdrawal_daily_cap', 'withdrawal_hold_hours',
]);

/**
 * ★ ALLOWED সেট, নয়তো Integration Hub-এর প্যাটার্ন-কী
 *   (integration_<category>_<id>_enabled / integration_<category>_active)।
 *
 * 🔴 বাগ (Group G-তে ধরা পড়ল): প্যাটার্নে হাইফেন ছিল না
 *    (`[a-z0-9_]+`), অথচ Integration Hub-এর প্রায় প্রতিটি
 *    gateway-id-তে হাইফেন আছে — `game-api`, `third-party`,
 *    `internal-auto`। ফলে ঐ প্রোভাইডারগুলোর চালু/বন্ধ ও
 *    "active" কী-গুলো এখানে **নীরবে বাদ** পড়ত: অ্যাডমিন টগল
 *    চাপতেন, ২০০ OK আসত, কিন্তু কিছুই সংরক্ষিত হতো না এবং
 *    প্রোভাইডার কখনো সক্রিয় হতো না। হাইফেন যোগ করা হলো।
 */
export function isAllowedSettingKey(key: string): boolean {
  return SETTINGS_ALLOWED.has(key) || /^integration_[a-z0-9_-]+$/.test(key);
}

/**
 * ★ একটি (কী, মান) জোড়া যাচাই ও সাফ।
 *   @returns লেখার মান; `null` = এই কী এখন লেখা হবে না (নীরবে বাদ)
 *   @throws ApiError(400) — অনুমোদিত কী-তে অবৈধ মান
 */
export function normalizeSettingValue(key: string, raw: unknown): string | null {
  if (!isAllowedSettingKey(key)) return null;

  let value = String(raw ?? '');

  // ★★★ বট টোকেন খালি মান দিয়ে **মুছে যাবে না**।
  //
  //   কেন: অ্যাডমিন UI ২০২৬-০৮-০৫ থেকে টোকেন আর ব্রাউজারে পাঠায়
  //   না (নিরাপত্তা), তাই ফর্ম সেভ করলে এই কী-টি হয় অনুপস্থিত
  //   থাকে, নয়তো ফাঁকা আসতে পারত। ফাঁকা মান লিখে দিলে একটি
  //   সাধারণ "সেভ" ক্লিকেই কনফিগ করা টোকেন মুছে যেত এবং সব
  //   অপারেটর নোটিফিকেশন নীরবে বন্ধ হয়ে যেত।
  //   ইচ্ছাকৃতভাবে মুছতে হলে DB-তে সরাসরি বা .env থেকে সরান।
  if (key === 'telegram_bot_token' && !value.trim()) return null;

  if (NUM_KEYS.has(key)) {
    const n = Number(value);
    // Number.isFinite also refuses "Infinity"/"1e999": an infinite
    // referral_bonus made every referred first-deposit approval throw.
    if (!Number.isFinite(n) || n < 0) throw new ApiError(`${key} — সঠিক সংখ্যা দিন`, 400);
    value = String(n);
  } else if (URL_KEYS.has(key)) {
    if (value) {
      const safe = safeUrl(value);
      if (!safe) throw new ApiError(`${key} — অবৈধ URL`, 400);
      value = safe;
    }
  } else {
    value = cleanText(value, 1000); // ★ XSS guard
  }

  return value;
}
