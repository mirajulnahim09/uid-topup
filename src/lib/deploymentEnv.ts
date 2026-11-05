/**
 * ═══════════════════════════════════════════════════════════
 * ★★★ O-15 — Vercel Preview কখনো বাইরের জগতে কিছু করে না
 *
 *   Preview-তে আলাদা ডাটাবেস থাকলেও (scripts/assert-preview-db.mjs),
 *   কোনো ভুল env-কপিতে আসল Resend/Telegram/গেম-API/পেমেন্ট কী চলে
 *   গেলে preview থেকে আসল গ্রাহককে ইমেইল, আসল চ্যানেলে বার্তা বা আসল
 *   টপ-আপ চলে যেতে পারত। তাই কী থাকুক বা না থাকুক, `VERCEL_ENV ===
 *   'preview'` হলে এই পথগুলো কোডেই বন্ধ:
 *     · ইমেইল (Resend)            — পাঠানো হয় না, লগে কেবল বিষয়
 *     · Telegram Bot API          — কল হয় না
 *     · গেম-প্রোভাইডার fulfillment — MANUAL-এ ফেরে, কল হয় না
 *     · SSLCommerz                — সবসময় sandbox হোস্ট (live কখনো নয়)
 *
 *   প্রতিবার কল-সময়ে পড়া হয় (মডিউল-লোডে নয়), যাতে টেস্টে env বদলানো যায়।
 * ═══════════════════════════════════════════════════════════
 */
export function isPreviewDeployment(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.VERCEL_ENV === 'preview';
}

export const PREVIEW_OUTBOUND_BLOCKED = 'Preview deployment: outbound side effects are disabled';
