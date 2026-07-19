/**
 * ★★★ ক্লায়েন্ট-সাইড অনুরোধ de-duplication (4.5)
 *
 *   ── সমস্যা ──
 *   `Navbar`, `MobileTabBar` আর `OrderForm` — তিনটিই আলাদাভাবে
 *   `/api/me` ডাকত। একটি প্রোডাক্ট পাতায় তিনটিই মাউন্ট হয়, তাই
 *   প্রতিটি পেজ লোডে **একই তথ্যের জন্য তিনটি অনুরোধ** যেত।
 *   `/api/notifications` এরও একই দশা।
 *
 *   ── সমাধান ও কেন এইটুকুই ──
 *   কোনো নতুন state library বা Context Provider যোগ করা হয়নি —
 *   সেটা পুরো কম্পোনেন্ট গাছ ছুঁতে হতো, ঝুঁকি বেশি। বদলে
 *   মডিউল-স্তরে দুটো জিনিস:
 *     ১. **in-flight ভাগাভাগি** — একই সময়ে ডাকা হলে সবাই একই
 *        Promise পায়, নেটওয়ার্কে যায় একটাই অনুরোধ।
 *     ২. **অল্পক্ষণের ক্যাশ** — remount হলে সাথে সাথে আবার
 *        অনুরোধ যায় না।
 *
 *   ⚠️ TTL ইচ্ছাকৃতভাবে **খুব ছোট (৫ সেকেন্ড)**, আর টাকা বদলানোর
 *   পর `invalidateMe()` ডাকা বাধ্যতামূলক। ব্যালেন্স বাসি দেখানো
 *   মানে গ্রাহক ভুল টাকা দেখে সিদ্ধান্ত নেবে — ক্যাশিং-এর সুবিধার
 *   চেয়ে সেই ভুল অনেক বেশি ক্ষতিকর।
 */

const TTL_MS = 5_000;

type Entry = { at: number; data: unknown };

const cache = new Map<string, Entry>();
const inFlight = new Map<string, Promise<unknown>>();

async function dedupedGet<T>(url: string): Promise<T> {
  const hit = cache.get(url);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.data as T;

  // ★ ইতিমধ্যে একই অনুরোধ চলমান — নতুন করে পাঠানোর দরকার নেই
  const running = inFlight.get(url);
  if (running) return running as Promise<T>;

  const p = (async () => {
    try {
      const res = await fetch(url);
      if (!res.ok) throw new Error(String(res.status));
      const data = (await res.json()) as T;
      cache.set(url, { at: Date.now(), data });
      return data;
    } finally {
      // ★ সফল হোক বা ব্যর্থ — in-flight ছেড়ে দিতেই হবে, নইলে
      //   একবার ব্যর্থ হলে ঐ URL চিরকাল আটকে থাকত
      inFlight.delete(url);
    }
  })();

  inFlight.set(url, p);
  return p;
}

export type MeData = { balance: string; name: string; referralCode: string } & Record<string, unknown>;

/** ইউজারের ব্যালেন্স/নাম — একাধিক কম্পোনেন্ট ডাকলেও একটিই অনুরোধ */
export function fetchMe<T = MeData>(): Promise<T> {
  return dedupedGet<T>('/api/me');
}

/** না-পড়া নোটিফিকেশন */
export function fetchNotifications<T = unknown>(): Promise<T> {
  return dedupedGet<T>('/api/notifications');
}

/**
 * ★ ক্যাশ বাতিল — **টাকা বদলানোর পর অবশ্যই ডাকতে হবে**
 *   (অর্ডার দেওয়া, ডিপোজিট জমা)। নাহলে ৫ সেকেন্ড পর্যন্ত
 *   পুরনো ব্যালেন্স দেখাত।
 */
export function invalidateMe(): void {
  cache.delete('/api/me');
}

export function invalidateNotifications(): void {
  cache.delete('/api/notifications');
}

/** সব বাতিল — লগআউট/লগইনে */
export function invalidateAll(): void {
  cache.clear();
}
