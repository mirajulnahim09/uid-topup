import { prisma } from '@/lib/prisma';
import { requireAdmin, apiError, ApiError, readJson } from '@/lib/guard';
import { invalidateSettings } from '@/lib/settings';
import { cleanText, safeUrl } from '@/lib/sanitize';
import { revalidatePath } from 'next/cache';
import { adminLog } from '@/lib/adminLog';
import { getIp } from '@/lib/rateLimit';
import { telegramEvent } from '@/lib/telegram';

// ★ শুধু এই key গুলো লেখা যাবে — arbitrary key নয়
//
// ⚠️ হোমপেজ বিপণন কনফিগ (Option A, additive): নিচের `home_*` ও
//    `float_*` কী-গুলো যোগ করা হয়েছে যাতে লাইভ-অ্যাক্টিভিটি ফিড,
//    বিশ্বাস-পরিসংখ্যান, বিশ্বাস-স্ট্রিপ ও ভাসমান-যোগাযোগ বোতাম
//    অ্যাডমিন থেকে চালু/বন্ধ ও কনফিগার করা যায়। রিচ কনটেন্ট
//    (পপআপ/হিরো/স্লাইডার/নোটিশ) আলাদা `Campaign` মডেলে থাকে;
//    এখানে কেবল টগল ও ছোট কনফিগ। কোনো বিদ্যমান key সরানো হয়নি।
const ALLOWED = new Set([
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
]);

const URL_KEYS = new Set(['site_logo', 'float_contact_value', 'site_url']);
const NUM_KEYS = new Set([
  'min_deposit', 'max_deposit', 'referral_bonus', 'referral_min_deposit',
  'home_live_activity_count',
]);

/**
 * ★ সাইট সেটিংস — এখানে min/max ডিপোজিট, রেফারেল বোনাস ও
 *   maintenance mode বদলানো যায়। সবগুলোই ব্যবসায়িক প্রভাব ফেলে,
 *   তাই কে কী বদলাল তা লগ হওয়া দরকার (3.3, AUDIT_REPORT.md M2)।
 */
export async function POST(req: Request) {
  try {
    const admin = await requireAdmin();
    const body = await readJson(req);
    if (typeof body !== 'object' || !body) throw new ApiError('অবৈধ ডেটা', 400);

    const updates: { key: string; value: string }[] = [];

    for (const [key, raw] of Object.entries(body)) {
      // ★ ALLOWED সেট, নয়তো Integration Hub-এর প্যাটার্ন-কী
      //   (integration_<category>_<id>_enabled / integration_<category>_active)।
      //   মান তবু cleanText দিয়ে সাফ হয় (XSS-নিরাপদ)।
      if (!ALLOWED.has(key) && !/^integration_[a-z0-9_]+$/.test(key)) continue;

      let value = String(raw ?? '');

      // ★★★ বট টোকেন খালি মান দিয়ে **মুছে যাবে না**।
      //
      //   কেন: অ্যাডমিন UI ২০২৬-০৮-০৫ থেকে টোকেন আর ব্রাউজারে পাঠায়
      //   না (নিরাপত্তা), তাই ফর্ম সেভ করলে এই কী-টি হয় অনুপস্থিত
      //   থাকে, নয়তো ফাঁকা আসতে পারত। ফাঁকা মান লিখে দিলে একটি
      //   সাধারণ "সেভ" ক্লিকেই কনফিগ করা টোকেন মুছে যেত এবং সব
      //   অপারেটর নোটিফিকেশন নীরবে বন্ধ হয়ে যেত।
      //   ইচ্ছাকৃতভাবে মুছতে হলে DB-তে সরাসরি বা .env থেকে সরান।
      if (key === 'telegram_bot_token' && !value.trim()) continue;

      if (NUM_KEYS.has(key)) {
        const n = Number(value);
        if (isNaN(n) || n < 0) throw new ApiError(`${key} — সঠিক সংখ্যা দিন`, 400);
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

      updates.push({ key, value });
    }

    const minU = updates.find((u: (typeof updates)[number]) => u.key === 'min_deposit');
    const maxU = updates.find((u: (typeof updates)[number]) => u.key === 'max_deposit');
    if (minU && maxU && Number(minU.value) >= Number(maxU.value)) {
      throw new ApiError('সর্বনিম্ন ডিপোজিট সর্বোচ্চের চেয়ে কম হতে হবে', 400);
    }

    // ★ মেইনটেন্যান্স মোড বদলাল কি না — লেখার **আগের** মান দরকার,
    //   নাহলে "বদলেছে" আর "একই মান আবার সেভ হয়েছে" আলাদা করা যেত না।
    const maintU = updates.find((u) => u.key === 'maintenance_mode');
    let maintBefore: string | null = null;
    if (maintU) {
      const row = await prisma.setting
        .findUnique({ where: { key: 'maintenance_mode' } })
        .catch(() => null);
      maintBefore = row?.value ?? '0';
    }

    await prisma.$transaction(
      updates.map((u: (typeof updates)[number]) =>
        prisma.setting.upsert({
          where: { key: u.key },
          update: { value: u.value },
          create: { key: u.key, value: u.value },
        })
      )
    );

    // ★ কোন কোন সেটিং বদলাল — নাম উল্লেখ করে, যাতে পরে
    //   "কে ডিপোজিট সীমা বদলেছিল" খুঁজে বের করা যায়
    //
    //   ⚠️ গোপন কী-র **মান** অডিট লগে যায় না। অডিট লগ DB-তে থাকে ও
    //   /admin/logs-এ দেখা যায়; সেখানে বট টোকেন লিখে রাখলে সেটিই
    //   আরেকটি ফাঁসের জায়গা হতো। কী-র নাম থাকে, মান নয়।
    if (updates.length > 0) {
      const SECRET_KEYS = new Set(['telegram_bot_token']);
      adminLog({
        adminId: admin.id,
        adminName: admin.name,
        action: 'SETTINGS_CHANGE',
        detail: updates
          .map((u) => (SECRET_KEYS.has(u.key) ? `${u.key}=<redacted>` : `${u.key}=${u.value}`))
          .join(', '),
        ip: getIp(req),
      }).catch(() => {});
    }

    // ★ সাইট বন্ধ/চালু হলে অপারেটর-গ্রুপে জানানো — এটি এমন ঘটনা
    //   যা সবার সাথে সাথে জানা দরকার (গ্রাহক অর্ডার করতে পারছে না)।
    if (maintU && maintBefore !== null && maintU.value !== maintBefore) {
      const on = maintU.value === '1';
      telegramEvent(
        'maintenance',
        on ? '🚧 মেইনটেন্যান্স মোড চালু' : '✅ মেইনটেন্যান্স মোড বন্ধ',
        on
          ? `সাইট এখন রক্ষণাবেক্ষণ মোডে — গ্রাহক অর্ডার করতে পারবে না। (${admin.name})`
          : `সাইট আবার স্বাভাবিক — অর্ডার নেওয়া চালু। (${admin.name})`,
        '/admin/site',
      );
    }

    revalidatePath('/', 'layout');
    // ★ ক্যাশ বাতিল (4.6) — পরিবর্তন যেন সাথে সাথেই কার্যকর হয়
    invalidateSettings();
    return Response.json({ success: true, updated: updates.length });
  } catch (e) {
    return apiError(e);
  }
}
