/**
 * ★★★ SLA ভঙ্গের সতর্কতা (3.9)
 *
 *   2.1 এ গ্রাহককে সময়ের প্রতিশ্রুতি দেখানো হয়েছে (`slaDueAt`)।
 *   কিন্তু প্রতিশ্রুতি দেখানো আর সেটি রাখা এক নয় — অ্যাডমিন যদি
 *   না জানে কোনটার সময় শেষ হয়ে আসছে, তাহলে কাউন্টডাউনটা শুধু
 *   গ্রাহককে হতাশ হতে দেখার একটা সুন্দর উপায় মাত্র।
 *
 *   এখানে সেই ফাঁকটা বন্ধ হয়: কোন অর্ডারগুলো সময়ের কাছাকাছি বা
 *   সময় পেরিয়ে গেছে, অ্যাডমিন তা এক নজরে দেখে।
 *
 *   ── কেন derived, কেন কোনো `slaBreached` কলাম নয় ──
 *   ভঙ্গ হওয়া সময়ের সাথে **নিজে থেকেই** ঘটে — কেউ কিছু না করলেও
 *   একটা অর্ডার নিজেই ভঙ্গ অবস্থায় ঢুকে যায়। ফ্ল্যাগ রাখলে সেটি
 *   লিখবে কে? কোনো ব্যাকগ্রাউন্ড জব নেই (Vercel serverless), তাই
 *   ফ্ল্যাগ সবসময় বাসি থাকত। `slaDueAt` আর ঘড়ি — এই দুটোই যথেষ্ট।
 *
 *   ⚠️ এটি *দেখার* সতর্কতা, *পাঠানোর* নয়। পুশ/ইমেইল/SMS অ্যালার্ট
 *   চালাতে শিডিউলার লাগে যা এখানে নেই — সেটি
 *   PRODUCTION_CHECKLIST.md এর কাজ।
 */

/** কত মিনিট বাকি থাকলে "সময় ঘনিয়ে এসেছে" ধরা হবে */
export const SLA_WARN_MIN = 30;

export type BreachLevel = 'ok' | 'soon' | 'breached';

export type BreachInfo = {
  level: BreachLevel;
  /** ধনাত্মক = এত মিনিট বাকি; ঋণাত্মক = এত মিনিট পেরিয়ে গেছে */
  minutesLeft: number;
};

/**
 * একটি অর্ডারের SLA অবস্থা।
 *
 * ⚠️ `slaDueAt` না থাকলে (পুরনো অর্ডার, 2.1 এর আগের) `ok` — কারণ
 *    যে প্রতিশ্রুতি কখনো দেওয়াই হয়নি, সেটি ভাঙাও যায় না। অনুমান
 *    করে ভঙ্গ দেখালে পুরনো অর্ডারগুলো মিথ্যা অ্যালার্ম তৈরি করত।
 */
export function breachInfo(
  order: { slaDueAt: Date | string | null; status: string },
  now: Date = new Date()
): BreachInfo {
  // ★ শেষ হয়ে যাওয়া অর্ডারের SLA আর প্রাসঙ্গিক নয়
  const open = order.status === 'PENDING' || order.status === 'PROCESSING';
  if (!open || !order.slaDueAt) return { level: 'ok', minutesLeft: 0 };

  const due = order.slaDueAt instanceof Date ? order.slaDueAt : new Date(order.slaDueAt);
  const minutesLeft = Math.round((due.getTime() - now.getTime()) / 60_000);

  if (minutesLeft < 0) return { level: 'breached', minutesLeft };
  if (minutesLeft <= SLA_WARN_MIN) return { level: 'soon', minutesLeft };
  return { level: 'ok', minutesLeft };
}

/** তালিকার জন্য গণনা — ব্যাজ ও ড্যাশবোর্ডে একই সংখ্যা দেখাতে */
export function countBreaches(
  orders: Array<{ slaDueAt: Date | string | null; status: string }>,
  now: Date = new Date()
): { breached: number; soon: number } {
  let breached = 0;
  let soon = 0;
  for (const o of orders) {
    const b = breachInfo(o, now);
    if (b.level === 'breached') breached++;
    else if (b.level === 'soon') soon++;
  }
  return { breached, soon };
}

/** অ্যাডমিনের জন্য ছোট লেবেল */
export function breachLabel(b: BreachInfo): string {
  if (b.level === 'breached') {
    const over = Math.abs(b.minutesLeft);
    return over >= 60
      ? `${Math.floor(over / 60)} ঘন্টা ${over % 60} মিনিট দেরি`
      : `${over} মিনিট দেরি`;
  }
  if (b.level === 'soon') return `${b.minutesLeft} মিনিট বাকি`;
  return '';
}
