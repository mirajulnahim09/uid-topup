/**
 * ═══════════════════════════════════════════════════════════
 * ★★★ SRE — সার্ভার-প্রসেসের শেষ জাল (Next.js instrumentation hook)
 *
 *   প্রতিটি সার্ভার-প্রসেস শুরুতে একবার `register()` চলে। এখানে Node-এর
 *   প্রসেস-স্তরের দুটি ইভেন্ট ধরা হয় — যেগুলো কোনো route-এর try/catch-এ
 *   কখনো পৌঁছায় না (যেমন `.catch()` ছাড়া fire-and-forget promise):
 *     · unhandledRejection — `logger.error` → errorReporter (SENTRY_DSN থাকলে)
 *     · uncaughtExceptionMonitor — কেবল দেখে, প্রসেসের আচরণ বদলায় না
 *
 *   ⚠️ OOM এখানে ধরা **যায় না** — V8 heap ফুরোলে প্রসেস সাথে সাথে মরে, কোনো
 *   JS আর চলে না। তার সংকেত কেবল Vercel-এর লগ/লগ-ড্রেনে ("Runtime exited" /
 *   "out of memory")। তাই এখানে আগাম সতর্কতা: heap সীমার ৮৫% পেরোলে একবার
 *   error (→ Sentry) — মরার **আগে** একটি চিহ্ন থাকে।
 *
 *   ⚠️ Edge runtime-এ `process.on` নেই — তাই কেবল `nodejs`।
 * ═══════════════════════════════════════════════════════════
 */
export async function register(): Promise<void> {
  // ★ Next-এর নথিভুক্ত ধরন: শর্তের **ভেতরে** dynamic import — edge বান্ডলে Node-কোড ঢোকে না
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    const { registerNodeProcessHooks } = await import('./lib/instrumentationNode');
    registerNodeProcessHooks();
  }
}
