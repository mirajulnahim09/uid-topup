/**
 * ═══════════════════════════════════════════════════════════
 * ★ ডেলিভারির প্রতিশ্রুতি (SLA) — সৎ ও যাচাইযোগ্য
 *
 *   কেন দরকার: ম্যানুয়াল ডেলিভারিতে গ্রাহকের সবচেয়ে বড় দুশ্চিন্তা
 *   "কতক্ষণ লাগবে?"। উত্তর না দিলে সে বারবার সাপোর্টে মেসেজ দেয়,
 *   অথবা ধরে নেয় প্রতারিত হয়েছে।
 *
 *   ★ নীতি: "Instant" বলা হবে না। ম্যানুয়াল সিস্টেমে সেটি মিথ্যা।
 *     বরং বাস্তব সময় বলা হয় — এবং সেটি রাখা হয়।
 *
 *   ★ অফিস সময়ের সততা: রাত ২টায় অর্ডার এলে "৩০ মিনিটে দেব"
 *     বলা প্রতারণা — অ্যাডমিন ঘুমিয়ে। তাই অফিস সময়ের বাইরে
 *     ডেডলাইন পরের দিন খোলার সময় থেকে গোনা হয়।
 * ═══════════════════════════════════════════════════════════
 */
import { APP_TIME_ZONE } from './date';
import { toBengaliDigits } from './money';

export type SlaConfig = {
  /** সাধারণত কত মিনিটে ডেলিভারি হয় */
  typicalMinutes: number;
  /** সর্বোচ্চ কত মিনিটের গ্যারান্টি */
  maxMinutes: number;
  /** অফিস শুরুর ঘন্টা (২৪-ঘন্টা, ঢাকা সময়) */
  openHour: number;
  /** অফিস শেষের ঘন্টা (২৪-ঘন্টা, ঢাকা সময়) */
  closeHour: number;
};

export const SLA_DEFAULTS: SlaConfig = {
  typicalMinutes: 15,
  maxMinutes: 120,
  openHour: 9,
  closeHour: 23,
};

/** সেটিংস থেকে SLA কনফিগ — অবৈধ/অনুপস্থিত মান হলে ডিফল্ট */
export function slaFromSettings(settings: Record<string, string>): SlaConfig {
  const num = (key: string, fallback: number, min: number, max: number) => {
    const n = Number(settings[key]);
    return Number.isFinite(n) && n >= min && n <= max ? n : fallback;
  };
  const cfg: SlaConfig = {
    typicalMinutes: num('sla_typical_minutes', SLA_DEFAULTS.typicalMinutes, 1, 1440),
    maxMinutes: num('sla_max_minutes', SLA_DEFAULTS.maxMinutes, 1, 10080),
    openHour: num('support_open_hour', SLA_DEFAULTS.openHour, 0, 23),
    closeHour: num('support_close_hour', SLA_DEFAULTS.closeHour, 1, 24),
  };
  // সর্বোচ্চ সময় সাধারণ সময়ের কম হতে পারে না
  if (cfg.maxMinutes < cfg.typicalMinutes) cfg.maxMinutes = cfg.typicalMinutes;
  return cfg;
}

/** ঢাকা সময়ে ঘন্টা ও মিনিট বের করে (সার্ভার যে টাইমজোনেই থাকুক) */
function dhakaParts(d: Date): { hour: number; minute: number } {
  const fmt = new Intl.DateTimeFormat('en-GB', {
    timeZone: APP_TIME_ZONE,
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
  const parts = fmt.formatToParts(d);
  const hour = Number(parts.find((p) => p.type === 'hour')?.value ?? '0');
  const minute = Number(parts.find((p) => p.type === 'minute')?.value ?? '0');
  return { hour: hour === 24 ? 0 : hour, minute };
}

/** এই মুহূর্তে কি অফিস খোলা? */
export function isWithinSupportHours(cfg: SlaConfig, now: Date = new Date()): boolean {
  const { hour } = dhakaParts(now);
  return hour >= cfg.openHour && hour < cfg.closeHour;
}

/**
 * ★ অর্ডারের ডেলিভারি ডেডলাইন হিসাব।
 *
 *   অফিস খোলা থাকলে: এখন + maxMinutes
 *   বন্ধ থাকলে: পরবর্তী খোলার সময় + maxMinutes
 *     (কারণ অ্যাডমিন না জাগা পর্যন্ত কাজ শুরুই হবে না — মিথ্যা
 *      প্রতিশ্রুতি দেওয়ার চেয়ে বেশি সময় বলা ভালো)
 */
export function computeSlaDueAt(cfg: SlaConfig, now: Date = new Date()): Date {
  const start = isWithinSupportHours(cfg, now) ? now : nextOpening(cfg, now);
  return new Date(start.getTime() + cfg.maxMinutes * 60_000);
}

/** পরবর্তী কবে অফিস খুলবে */
export function nextOpening(cfg: SlaConfig, now: Date = new Date()): Date {
  const { hour, minute } = dhakaParts(now);
  const minutesNow = hour * 60 + minute;
  const openMinutes = cfg.openHour * 60;

  // আজ এখনো খোলেনি → আজকের খোলার সময়; নাহলে আগামীকাল
  const deltaMinutes =
    minutesNow < openMinutes
      ? openMinutes - minutesNow
      : 24 * 60 - minutesNow + openMinutes;

  return new Date(now.getTime() + deltaMinutes * 60_000);
}

/** গ্রাহককে দেখানোর জন্য মানুষ-পাঠযোগ্য বাক্য (কেনার আগে) */
export function slaPromiseText(cfg: SlaConfig): string {
  /**
   * ⚠️ "…মিনিটে" এর মতো প্রত্যয় বসানো যায় না, কারণ এককটি বদলায়:
   *   অ্যাডমিন `sla_typical_minutes` ৬০ বা তার বেশি দিলে
   *   `formatDuration` "২ ঘন্টা" ফেরত দেয়, আর তাতে "ে" জুড়লে
   *   দাঁড়াত **"২ ঘন্টাে"** — বাংলায় এমন শব্দ নেই। ড্যাশেই যথেষ্ট।
   */
  return `সাধারণত ${formatDuration(cfg.typicalMinutes)} — সর্বোচ্চ ${formatDuration(cfg.maxMinutes)}`;
}

/**
 * ★ একটি নির্দিষ্ট অর্ডারের জন্য ব্যাখ্যা।
 *
 *   কেন আলাদা: অফিস বন্ধ থাকাকালে দেওয়া অর্ডারের ডেডলাইন অনেক
 *   পরে হয়। তখন "সর্বোচ্চ ২ ঘন্টা" লেখা আর ৯ ঘন্টার কাউন্টডাউন
 *   একসাথে দেখালে গ্রাহক বিভ্রান্ত হয় ও অবিশ্বাস জন্মায়।
 *   তাই কারণটা স্পষ্ট করে বলা হয়।
 */
export function slaExplanationForOrder(
  cfg: SlaConfig,
  createdAt: Date,
  slaDueAt: Date | null
): string {
  if (!slaDueAt) return slaPromiseText(cfg);

  const windowMinutes = (slaDueAt.getTime() - createdAt.getTime()) / 60_000;
  // সহনশীলতা ৫ মিনিট — সাধারণ ক্ষেত্রে window ≈ maxMinutes
  const deferred = windowMinutes > cfg.maxMinutes + 5;

  if (deferred) {
    return (
      `অর্ডারের সময় অফিস বন্ধ ছিল, তাই সকাল ${toBengaliDigits(cfg.openHour)}টা থেকে প্রসেস শুরু হবে — ` +
      `এরপর সর্বোচ্চ ${formatDuration(cfg.maxMinutes)}।`
    );
  }
  return `${slaPromiseText(cfg)}।`;
}

/**
 * মিনিটকে বাংলা-বান্ধব সময়ে রূপান্তর (৯০ → "১ ঘন্টা ৩০ মিনিট")
 *
 * ⚠️ ফাংশনের নামে "বাংলা-বান্ধব" লেখা ছিল, কিন্তু অঙ্কগুলো ল্যাটিনই
 *   থাকত — হোমপেজে মাপা: *"আনুমানিক 2 ঘন্টা পর্যন্ত"*, ঠিক তার নিচেই
 *   "২০ মিনিটের ভিতরে" ও "১০০% ফেরত"। এক বাক্যে দুই লিপি।
 *   টাকার অঙ্ক অপরিবর্তিত — কারণ money.ts এ লেখা আছে।
 */
export function formatDuration(totalMinutes: number): string {
  const m = Math.max(0, Math.round(totalMinutes));
  const h = Math.floor(m / 60);
  const rem = m % 60;
  const bn = toBengaliDigits;
  if (h === 0) return `${bn(m)} মিনিট`;
  if (rem === 0) return `${bn(h)} ঘন্টা`;
  return `${bn(h)} ঘন্টা ${bn(rem)} মিনিট`;
}
