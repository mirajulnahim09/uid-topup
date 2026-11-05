/**
 * ★★★ অর্ডার claim / lock — একাধিক অ্যাডমিনের সমন্বয় (3.7)
 *
 *   ── কোন সমস্যাটা এটি সমাধান করে ──
 *   `/api/admin/order` এর `SELECT ... FOR UPDATE` row-lock আগে থেকেই
 *   ডাটাবেস-স্তরের ডাবল-প্রসেসিং ঠেকায় — দুজন একসাথে FAIL চাপলেও
 *   একবারই রিফান্ড হয়। সেটি অপরিবর্তিত, এবং সেটিই টাকার আসল রক্ষা।
 *
 *   কিন্তু row-lock একটা ক্ষতি কখনোই ঠেকাতে পারে না — যেটা সিস্টেমের
 *   **বাইরে** ঘটে। রাকিব অর্ডার #১২ দেখে গেমে ৫২০ ডায়মন্ড পাঠাল;
 *   একই মুহূর্তে সাকিবও একই অর্ডার দেখে পাঠাল। ডাটাবেসে একটাই
 *   COMPLETE লেখা হবে (লক ঠিকই কাজ করেছে), কিন্তু বাস্তবে দুবার
 *   ডায়মন্ড কেনা হয়ে গেছে — সেই টাকা আর ফেরত আসে না।
 *
 *   claim সেই সমন্বয়ের সংকেত: "এই অর্ডারটা আমি ধরেছি"।
 *
 *   ── তিনটি নকশা-সিদ্ধান্ত, যাতে claim নিজেই সমস্যা না হয়ে যায় ──
 *
 *   ১. **মেয়াদ ফুরায়** (CLAIM_TTL_MIN)। অ্যাডমিন ট্যাব বন্ধ করে চলে
 *      গেলে অর্ডার চিরকাল আটকে থাকতে পারে না। পুরনো claim এমনিতেই
 *      মুক্ত ধরা হয় — কোনো ক্লিনআপ জব লাগে না।
 *
 *   ২. **সবসময় টেক-ওভার করা যায়**। claim কখনো চূড়ান্ত বাধা নয়,
 *      শুধু একটি ইচ্ছাকৃত অতিরিক্ত ধাপ। নাহলে এটি অর্ডার জমে যাওয়ার
 *      নতুন কারণ হতো — গ্রাহকের ক্ষতি।
 *
 *   ৩. **হিসাব derived, cache নয়**। "মুক্ত না ধরা" প্রতিবার সময়
 *      থেকে গোনা হয়, আলাদা ফ্ল্যাগ রাখা হয় না — বাসি অবস্থার
 *      সম্ভাবনাই থাকে না।
 */

/** কত মিনিট পর claim এমনিতেই মুক্ত ধরা হবে */
export const CLAIM_TTL_MIN = 15;

/** ★ অটো-ডেলিভারির claim-পরিচয় — `fulfillment/autoFulfill.ts` এটিই লেখে */
export const AUTO_FULFILL_ACTOR_ID = 'system:auto-fulfill';

/**
 * ★★★ D1-1 — প্রোভাইডার-কল "চলমান" ধরা হয় claim-এর পর এতক্ষণ।
 *
 *   কেন ২ মিনিট: অর্ডার-রুটের `maxDuration` ৬০s, আর প্রোভাইডার-চেষ্টার সর্বোচ্চ
 *   যোগফল (৩ × ১৫s টাইমআউট + ১.২s ব্যাক-অফ) ≈ ৪৬s। অর্থাৎ ২ মিনিট পরেও
 *   claim থাকলে ফাংশনটি নিশ্চিতভাবে মৃত — তখন ফল **অজানা**, চলমান নয়।
 *   সেই অর্ডার sla-breach ক্রন `sweepStuckAutoFulfill()` দিয়ে ম্যানুয়াল কিউতে
 *   ফেরায়, "যাচাই করে তবেই" সতর্কবার্তাসহ।
 */
export const AUTO_INFLIGHT_MAX_MS = 2 * 60 * 1000;

/**
 * ★★★ D1-1 — অটো-ডেলিভারি এই মুহূর্তে প্রোভাইডারের উত্তরের অপেক্ষায়?
 *
 *   সত্য হলে অ্যাডমিনের FAIL / COMPLETE / টেক-ওভার **টেক-ওভার দিয়েও** চলে না।
 *   প্রমাণিত ক্ষতি (tests/auto-fulfill-takeover-race): ধীর প্রোভাইডারের ফাঁকে
 *   টেক-ওভার-FAIL → পুরো রিফান্ড, তারপর প্রোভাইডার "delivered" → গ্রাহক ডায়মন্ড
 *   ও টাকা দুটোই পেলেন, খতিয়ান নিখুঁত মেলায় কোনো reconcile তা ধরে না।
 *   সাধারণ claim-এর মতো মানুষের অনুমানের উপর ছাড়া যায় না, কারণ এখানে "কাজ
 *   চলছে কি না" অ্যাডমিন দেখতেই পান না — প্রোভাইডারের ভেতরে ঘটছে।
 */
export function isAutoFulfillInFlight(
  order: { status: string; claimedById: string | null; claimedAt: Date | string | null },
  now: Date = new Date(),
): boolean {
  if (order.status !== 'PROCESSING' || order.claimedById !== AUTO_FULFILL_ACTOR_ID || !order.claimedAt) {
    return false;
  }
  const at = order.claimedAt instanceof Date ? order.claimedAt : new Date(order.claimedAt);
  return now.getTime() - at.getTime() < AUTO_INFLIGHT_MAX_MS;
}

export const AUTO_INFLIGHT_MESSAGE =
  'অটো-ডেলিভারি এই মুহূর্তে গেম-প্রোভাইডারের উত্তরের অপেক্ষায়। ফল না জেনে বাতিল বা হাতে ডেলিভার করলে গ্রাহক ডায়মন্ড ও টাকা দুটোই পেতে পারেন — এক-দুই মিনিট পর আবার দেখুন।';

export type ClaimFields = {
  claimedById: string | null;
  claimedByName: string | null;
  claimedAt: Date | string | null;
};

export type ClaimState =
  /** কেউ ধরেনি — নির্দ্বিধায় কাজ করা যায় */
  | { state: 'free' }
  /** আমিই ধরেছি */
  | { state: 'mine'; byName: string; ageMin: number }
  /** অন্য অ্যাডমিন এখন কাজ করছে — টেক-ওভার লাগবে */
  | { state: 'held'; byId: string; byName: string; ageMin: number }
  /** ধরা ছিল, কিন্তু মেয়াদ ফুরিয়েছে — মুক্তের মতোই */
  | { state: 'stale'; byId: string; byName: string; ageMin: number };

/**
 * claim-এর বর্তমান অবস্থা বের করে।
 * বিশুদ্ধ ফাংশন — DB ছাড়াই পরীক্ষা করা যায়।
 */
export function claimState(
  order: ClaimFields,
  viewerId: string,
  now: Date = new Date()
): ClaimState {
  if (!order.claimedById || !order.claimedAt) return { state: 'free' };

  const at = order.claimedAt instanceof Date ? order.claimedAt : new Date(order.claimedAt);
  const ageMin = Math.max(0, Math.floor((now.getTime() - at.getTime()) / 60_000));
  const byName = order.claimedByName || 'একজন অ্যাডমিন';

  if (order.claimedById === viewerId) return { state: 'mine', byName, ageMin };
  if (ageMin >= CLAIM_TTL_MIN) {
    return { state: 'stale', byId: order.claimedById, byName, ageMin };
  }
  return { state: 'held', byId: order.claimedById, byName, ageMin };
}

/**
 * অন্যের সক্রিয় claim আটকাচ্ছে কি না।
 *
 * ⚠️ শুধু `held` আটকায়। `stale` আটকায় না — সেটাই ৩ নং সিদ্ধান্তের
 *    বাস্তবায়ন: মেয়াদোত্তীর্ণ claim কখনো কাজ থামায় না।
 */
export function isBlockedByOther(state: ClaimState): boolean {
  return state.state === 'held';
}

/** অন্য অ্যাডমিন কাজ করছে — অ্যাকশনের আগে দেখানো বার্তা */
export function claimBlockMessage(state: ClaimState): string {
  if (state.state !== 'held') return '';
  const age = state.ageMin === 0 ? 'এইমাত্র' : `${state.ageMin} মিনিট ধরে`;
  return `${state.byName} ${age} এই অর্ডারে কাজ করছেন। দুজনে একসাথে ডেলিভারি দিলে দুবার খরচ হয়ে যাবে — নিশ্চিত হয়ে তবেই টেক ওভার করুন।`;
}

/** তালিকায় দেখানোর ছোট লেবেল */
export function claimLabel(state: ClaimState): string {
  switch (state.state) {
    case 'mine':
      return 'আপনি ধরেছেন';
    case 'held':
      return `${state.byName} দেখছেন`;
    case 'stale':
      return `${state.byName} ছেড়ে গেছেন`;
    case 'free':
      return '';
  }
}
