import { prisma } from '../prisma';
import { esc } from './api';

/**
 * ═══════════════════════════════════════════════════════════
 * ★★★ বার্তা টেমপ্লেট — {{variable}} সহ
 *
 *   অ্যাডমিন প্রতিটি বার্তার ভাষা নিজের মতো লিখতে পারে। টেমপ্লেট না
 *   থাকলে কোডে লেখা ডিফল্ট বার্তাই যায় — অর্থাৎ টেমপ্লেট **ঐচ্ছিক
 *   স্তর**, বাধ্যতামূলক নির্ভরতা নয়। এতে বিদ্যমান কোনো কল-সাইট ভাঙে না।
 *
 *   ── নিরাপত্তা ──
 *   বার্তা HTML parse-mode-এ যায়। তাই **চলকের মান** সবসময় `esc()` করা
 *   হয় (গ্রাহকের নাম/নোটে `<` থাকলে টেলিগ্রাম পুরো বার্তা প্রত্যাখ্যান
 *   করত)। টেমপ্লেটের নিজের লেখা escape করা হয় **না** — অ্যাডমিন
 *   ইচ্ছাকৃতভাবে <b>/<i> ব্যবহার করতে পারে; সে বিশ্বস্ত ও অনুমোদিত।
 * ═══════════════════════════════════════════════════════════
 */

export type TemplateVar = { key: string; label: string; sample: string };

/** সব টেমপ্লেটে ব্যবহারযোগ্য সাধারণ চলক */
export const COMMON_VARS: TemplateVar[] = [
  { key: 'site_name', label: 'সাইটের নাম', sample: 'SS UID TOPUP' },
  { key: 'date', label: 'তারিখ', sample: '০৫/০৮/২০২৬' },
  { key: 'time', label: 'সময়', sample: '০৯:৩০' },
];

export const TEMPLATES = [
  {
    key: 'deposit_approved', label: 'ডিপোজিট অনুমোদিত',
    vars: ['customer_name', 'amount', 'wallet_balance'],
    body: '✅ <b>ডিপোজিট অনুমোদিত</b>\n{{customer_name}} — ৳{{amount}}\nবর্তমান ব্যালেন্স: ৳{{wallet_balance}}',
  },
  {
    key: 'order_completed', label: 'অর্ডার সম্পন্ন',
    vars: ['customer_name', 'order_id', 'product_name', 'amount'],
    body: '🎉 <b>অর্ডার সম্পন্ন</b>\n#{{order_id}} — {{product_name}}\n{{customer_name}} — ৳{{amount}}',
  },
  {
    key: 'refund', label: 'রিফান্ড',
    vars: ['customer_name', 'order_id', 'amount'],
    body: '💸 <b>রিফান্ড</b>\n#{{order_id}} — ৳{{amount}} ফেরত\n{{customer_name}}',
  },
  {
    key: 'campaign', label: 'ক্যাম্পেইন',
    vars: ['campaign_name', 'coupon'],
    body: '📣 <b>ক্যাম্পেইন</b>\n{{campaign_name}}\nকুপন: <code>{{coupon}}</code>',
  },
  {
    key: 'reminder', label: 'রিমাইন্ডার',
    vars: ['count', 'subject'],
    body: '⏰ <b>রিমাইন্ডার</b>\n{{count}}টি {{subject}} অপেক্ষা করছে।',
  },
  {
    key: 'daily_summary', label: 'দৈনিক সারসংক্ষেপ',
    vars: ['orders', 'revenue', 'deposits', 'pending'],
    body: '📊 <b>দৈনিক সারসংক্ষেপ</b> — {{date}}\nঅর্ডার: {{orders}}\nআয়: ৳{{revenue}}\nডিপোজিট: {{deposits}}\nপেন্ডিং: {{pending}}',
  },
  {
    key: 'weekly_summary', label: 'সাপ্তাহিক সারসংক্ষেপ',
    vars: ['orders', 'revenue', 'deposits', 'pending'],
    body: '📈 <b>সাপ্তাহিক সারসংক্ষেপ</b>\nঅর্ডার: {{orders}}\nআয়: ৳{{revenue}}\nডিপোজিট: {{deposits}}\nপেন্ডিং: {{pending}}',
  },
] as const;

export type TemplateKey = (typeof TEMPLATES)[number]['key'];

/** প্রতিটি চলকের মানুষ-পাঠযোগ্য নাম ও নমুনা (লাইভ প্রিভিউয়ের জন্য) */
export const VAR_META: Record<string, TemplateVar> = {
  customer_name: { key: 'customer_name', label: 'গ্রাহকের নাম', sample: 'রহিম উদ্দিন' },
  order_id: { key: 'order_id', label: 'অর্ডার নাম্বার', sample: '1042' },
  amount: { key: 'amount', label: 'টাকার অঙ্ক', sample: '৫০০.০০' },
  wallet_balance: { key: 'wallet_balance', label: 'ওয়ালেট ব্যালেন্স', sample: '১,২৫০.০০' },
  product_name: { key: 'product_name', label: 'প্রোডাক্টের নাম', sample: 'Free Fire 520 Diamond' },
  coupon: { key: 'coupon', label: 'কুপন কোড', sample: 'EID50' },
  campaign_name: { key: 'campaign_name', label: 'ক্যাম্পেইনের নাম', sample: 'ঈদ অফার' },
  count: { key: 'count', label: 'সংখ্যা', sample: '৭' },
  subject: { key: 'subject', label: 'বিষয়', sample: 'পেন্ডিং অর্ডার' },
  orders: { key: 'orders', label: 'অর্ডার সংখ্যা', sample: '২৩' },
  revenue: { key: 'revenue', label: 'আয়', sample: '১২,৪০০.০০' },
  deposits: { key: 'deposits', label: 'ডিপোজিট সংখ্যা', sample: '১১' },
  pending: { key: 'pending', label: 'পেন্ডিং', sample: '৪' },
  ...Object.fromEntries(COMMON_VARS.map((v) => [v.key, v])),
};

/** একটি টেমপ্লেটে ব্যবহারযোগ্য সব চলক (নিজস্ব + সাধারণ) */
export function varsFor(key: string): TemplateVar[] {
  const def = TEMPLATES.find((t) => t.key === key);
  const own = (def?.vars ?? []).map((v) => VAR_META[v]).filter(Boolean);
  return [...own, ...COMMON_VARS];
}

/**
 * চলক প্রতিস্থাপন। অজানা `{{x}}` **অপরিবর্তিত** রেখে দেওয়া হয় —
 * নীরবে ফাঁকা করে দিলে অ্যাডমিন বুঝতেই পারত না যে বানান ভুল করেছে।
 */
export function render(body: string, vars: Record<string, string | number>): string {
  return body.replace(/\{\{\s*([a-z0-9_]+)\s*\}\}/gi, (whole, name: string) => {
    const v = vars[name];
    return v === undefined || v === null ? whole : esc(String(v));
  });
}

/** Telegram's attribute-free formatting tags — the only markup the preview keeps. */
const PREVIEW_TAGS = /&lt;(\/?)(b|strong|i|em|u|ins|s|strike|del|code|pre)&gt;/gi;

/** প্রিভিউ — নমুনা মান দিয়ে রেন্ডার */
export function preview(body: string, key: string): string {
  const vars: Record<string, string> = {};
  for (const v of varsFor(key)) vars[v.key] = v.sample;
  // The admin panel injects this with dangerouslySetInnerHTML and the body is
  // admin-written: escape it all, then re-allow only plain formatting tags,
  // so a stored <img onerror> never reaches another admin's page.
  return render(esc(body).replace(PREVIEW_TAGS, '<$1$2>'), vars);
}

export type StoredTemplate = { key: string; label: string; body: string; enabled: boolean; isDefault: boolean };

/** সব টেমপ্লেট — DB-তে না থাকলে কোডের ডিফল্ট */
export async function getTemplates(): Promise<StoredTemplate[]> {
  let rows: { key: string; label: string; body: string; enabled: boolean }[] = [];
  try {
    rows = await prisma.telegramTemplate.findMany();
  } catch { rows = []; }
  const byKey = new Map(rows.map((r) => [r.key, r]));
  return TEMPLATES.map((t) => {
    const row = byKey.get(t.key);
    return {
      key: t.key, label: t.label,
      body: row?.body ?? t.body,
      enabled: row?.enabled ?? true,
      isDefault: !row,
    };
  });
}

/** একটি টেমপ্লেটের কার্যকর শরীর (DB → ডিফল্ট) */
export async function getTemplateBody(key: string): Promise<string | null> {
  const def = TEMPLATES.find((t) => t.key === key);
  try {
    const row = await prisma.telegramTemplate.findUnique({ where: { key } });
    if (row && row.enabled === false) return null; // বন্ধ = কোডের ডিফল্ট ব্যবহার হবে
    if (row) return row.body;
  } catch { /* ডিফল্টে পড়ে যাই */ }
  return def?.body ?? null;
}

/**
 * টেমপ্লেট দিয়ে বার্তা বানানো — টেমপ্লেট না থাকলে `null`,
 * তখন কল-সাইট তার নিজের ডিফল্ট বার্তা ব্যবহার করে।
 */
export async function renderTemplate(
  key: string,
  vars: Record<string, string | number>,
): Promise<string | null> {
  const body = await getTemplateBody(key);
  if (!body) return null;
  return render(body, vars);
}

export async function saveTemplate(key: string, body: string, enabled: boolean, label: string): Promise<void> {
  await prisma.telegramTemplate.upsert({
    where: { key },
    update: { body, enabled, label },
    create: { key, body, enabled, label },
  });
}

/** ডিফল্টে ফিরিয়ে আনা — সারি মুছে দিলেই কোডের ডিফল্ট কার্যকর */
export async function resetTemplate(key: string): Promise<void> {
  await prisma.telegramTemplate.deleteMany({ where: { key } });
}
