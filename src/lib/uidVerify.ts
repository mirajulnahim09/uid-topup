import { prisma } from './prisma';
import { logger } from './logger';

/**
 * ═══════════════════════════════════════════════════════════
 * ★ Player UID যাচাই — ভুল অ্যাকাউন্টে টপ-আপ ঠেকানোর ব্যবস্থা
 *
 *   কেন এটাই সবচেয়ে জরুরি ফিচার:
 *   ভুল UID তে ডায়মন্ড গেলে সেটা **ফেরত আনা অসম্ভব**। অন্য কারো
 *   অ্যাকাউন্টে চলে যায়, গ্রাহকের টাকা যায়, দোষ পড়ে আমাদের উপর।
 *   প্রতিযোগীরা শুধু দাবিত্যাগ (disclaimer) লেখে — সেটা ক্ষতি
 *   ঠেকায় না, শুধু দোষ সরায়।
 *
 *   ═══ দুই স্তরের সুরক্ষা ═══
 *
 *   ১. PROVIDER যাচাই (থাকলে): UID দিয়ে আসল গেম-নাম এনে দেখানো —
 *      "ProGamerBD — এটা কি আপনার অ্যাকাউন্ট?"
 *
 *   ২. DOUBLE-ENTRY fallback (provider না থাকলে): UID দুইবার
 *      লিখতে বলা। টাইপো ধরা পড়ে — কারণ একই ভুল দুইবার হয় না।
 *
 *   ⚠️ নীতি: provider বন্ধ/ব্যর্থ হলেও বিক্রি **থামবে না**।
 *      তৃতীয় পক্ষের সার্ভিস ডাউন থাকলে ব্যবসা বন্ধ হতে পারে না —
 *      তখন fallback চলবে (IDEAL_PLATFORM_ARCHITECTURE.md §4.2)।
 * ═══════════════════════════════════════════════════════════
 */

/** ক্যাশ কতক্ষণ বৈধ — গেম-নাম খুব কমই বদলায় */
const CACHE_TTL_MS = 24 * 60 * 60 * 1000; // ২৪ ঘন্টা

export type UidVerifyResult =
  /** যাচাই সফল — আসল নাম পাওয়া গেছে */
  | { status: 'verified'; playerName: string; cached: boolean }
  /** এই প্রোডাক্টে যাচাই সম্ভব নয় (provider সেট করা নেই) */
  | { status: 'unavailable'; reason: 'no_provider' }
  /** provider আছে কিন্তু এখন সাড়া দিচ্ছে না — বিক্রি থামবে না */
  | { status: 'unavailable'; reason: 'provider_error' }
  /** provider বলছে এই UID নেই — এটাই প্রকৃত সুরক্ষা */
  | { status: 'not_found' };

/**
 * ★ একটি provider — বাইরের সার্ভিসে UID পাঠিয়ে নাম আনে।
 *   নতুন provider যোগ করতে শুধু PROVIDERS এ একটি এন্ট্রি দিন।
 */
type UidProvider = {
  /** কনফিগার করা আছে কি? (API key ইত্যাদি) */
  isConfigured: () => boolean;
  /** নাম আনে; না পেলে null; ত্রুটি হলে throw */
  lookup: (uid: string) => Promise<string | null>;
};

/**
 * ★ Provider রেজিস্ট্রি।
 *
 *   ⚠️ বর্তমানে কোনো provider কনফিগার করা নেই — Free Fire এর কোনো
 *   পাবলিক UID লুকআপ API নেই। বাণিজ্যিক provider নেওয়া হলে এখানে
 *   যোগ করুন এবং Product.uidValidationProvider এ নাম বসান।
 *   ততক্ষণ double-entry fallback ই সুরক্ষা দেয়।
 */
const PROVIDERS: Record<string, UidProvider> = {
  // উদাহরণ কাঠামো — সত্যিকারের provider পেলে এভাবে যোগ হবে:
  //
  // freefire_bd: {
  //   isConfigured: () => !!process.env.FF_LOOKUP_API_KEY,
  //   lookup: async (uid) => {
  //     const r = await fetch(`https://provider.example/lookup?uid=${uid}`, {
  //       headers: { Authorization: `Bearer ${process.env.FF_LOOKUP_API_KEY}` },
  //       signal: AbortSignal.timeout(5000),
  //     });
  //     if (r.status === 404) return null;
  //     if (!r.ok) throw new Error(`provider ${r.status}`);
  //     return (await r.json()).nickname ?? null;
  //   },
  // },
};

/** এই প্রোডাক্টে লাইভ যাচাই সম্ভব কি? — UI কোন মোড দেখাবে তা ঠিক করে */
export function isVerificationAvailable(providerKey: string | null | undefined): boolean {
  if (!providerKey) return false;
  const p = PROVIDERS[providerKey];
  return !!p && p.isConfigured();
}

/**
 * ★ UID যাচাই — ক্যাশ সহ, কখনো throw করে না।
 *   যেকোনো সমস্যায় 'unavailable' ফেরত দেয় যাতে ডাকা কোড
 *   নিরাপদে fallback এ যেতে পারে।
 */
export async function verifyUid(
  providerKey: string | null | undefined,
  uid: string
): Promise<UidVerifyResult> {
  if (!providerKey) return { status: 'unavailable', reason: 'no_provider' };

  const provider = PROVIDERS[providerKey];
  if (!provider || !provider.isConfigured()) {
    return { status: 'unavailable', reason: 'no_provider' };
  }

  const cleanUid = uid.trim();

  // ── ১. ক্যাশ দেখি ──
  try {
    const hit = await prisma.uidLookupCache.findUnique({
      where: { provider_uid: { provider: providerKey, uid: cleanUid } },
    });
    if (hit && Date.now() - hit.checkedAt.getTime() < CACHE_TTL_MS) {
      return { status: 'verified', playerName: hit.playerName, cached: true };
    }
  } catch {
    // ক্যাশ পড়া না গেলেও এগিয়ে যাই — ক্যাশ optimization, নির্ভরতা নয়
  }

  // ── ২. উজানে জিজ্ঞেস করি ──
  let name: string | null;
  try {
    name = await provider.lookup(cleanUid);
  } catch (e) {
    logger.error('uidVerify', 'provider error', { err: e });
    // ★ বিক্রি থামানো যাবে না — fallback এ যাক
    return { status: 'unavailable', reason: 'provider_error' };
  }

  if (!name) return { status: 'not_found' };

  // ── ৩. ক্যাশে রাখি (ব্যর্থ হলেও ফলাফল ফেরত দিই) ──
  try {
    await prisma.uidLookupCache.upsert({
      where: { provider_uid: { provider: providerKey, uid: cleanUid } },
      update: { playerName: name, checkedAt: new Date() },
      create: { provider: providerKey, uid: cleanUid, playerName: name },
    });
  } catch {
    /* ক্যাশ লেখা ঐচ্ছিক */
  }

  return { status: 'verified', playerName: name, cached: false };
}
