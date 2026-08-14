/**
 * ═══════════════════════════════════════════════════════════
 * ★★★ auth কুকির নাম — একমাত্র উৎস (single source of truth)
 *
 *   ── কেন এই ফাইলটি আলাদা করে দরকার হলো ──
 *
 *   ২০২৬-০৮-১৪ তারিখে লাইভ সাইটে মাপা একটি বাগ: লগইন সফল হতো,
 *   কিন্তু `/account` বা `/admin` এ গেলেই আবার `/login` এ ফেরত।
 *   মোবাইল-নির্দিষ্ট মনে হয়েছিল, আসলে দুই প্ল্যাটফর্মেই ছিল —
 *   ফোনে ধরা পড়ে কারণ ফোন থেকে সরাসরি ড্যাশবোর্ডেই যাওয়া হয়।
 *
 *   কারণ: কুকির নাম **দুই জায়গায় দুইভাবে** ঠিক হতো।
 *
 *     · `auth.ts` (NextAuth কোর) নাম ঠিক করত `NODE_ENV` দেখে →
 *       প্রোডাকশনে `__Secure-next-auth.session-token` লিখত।
 *
 *     · `middleware.ts` এর `getToken()` নিজে থেকে নাম **অনুমান**
 *       করে নিত, আর সেই অনুমান `NEXTAUTH_URL` এর উপর নির্ভরশীল
 *       (next-auth 4.24.15 · `jwt/index.js:65`):
 *
 *           secureCookie = NEXTAUTH_URL?.startsWith("https://")
 *                          ?? !!process.env.VERCEL
 *           cookieName   = secureCookie ? "__Secure-next-auth.session-token"
 *                                       : "next-auth.session-token"
 *
 *       লাইভ ডিপ্লয়মেন্টে `NEXTAUTH_URL` **https ছিল না** (প্রমাণ:
 *       `/api/auth/providers` উত্তর দিত
 *       `"callbackUrl":"http://localhost:3000/api/auth/callback/google"`)।
 *       তাই `secureCookie` হতো `false`, আর middleware খুঁজত
 *       `next-auth.session-token` — যে নামের কুকি কখনো লেখাই হয়নি।
 *
 *   ফল: middleware প্রতিবার `token = null` পেত এবং সুরক্ষিত প্রতিটি
 *   রুট `/login` এ 307 করত। সেশন ঠিকই ছিল (`/api/auth/session` কাজ
 *   করত, কারণ কোর নিজের নামটাই পড়ে) — কেবল middleware অন্ধ ছিল।
 *
 *   ── সমাধানের নীতি ──
 *   নাম আর **কোথাও অনুমান করা হয় না**। দুই পক্ষই এই ফাইল থেকে
 *   একই ধ্রুবক পড়ে, তাই `NEXTAUTH_URL` ভুল থাকলেও দুই পক্ষ কখনো
 *   দ্বিমত করতে পারে না। env ঠিক করাটা তবু দরকার (Google OAuth
 *   `NEXTAUTH_URL` থেকেই redirect_uri বানায়) — কিন্তু সেটি আর
 *   রুট-সুরক্ষা ভাঙতে পারবে না।
 *
 *   ⚠️ এই ফাইলে **কোনো import রাখা যাবে না**। `middleware.ts` edge
 *   রানটাইমে চলে; prisma/bcrypt টানলে সেখানেই ভেঙে পড়ত। তাই
 *   `auth.ts` থেকে সরাসরি import না করে এই ছোট ফাইলটি আলাদা।
 *
 *   ⚠️ শর্তটি `NODE_ENV` — request এর প্রোটোকল নয়। ফলে প্রোডাকশন
 *   বিল্ড **http তে** চালালে (`next start` লোকালি) ব্রাউজার
 *   `__Secure-` কুকি সংরক্ষণই করবে না, লগইন টিকবে না। এটি জানা ও
 *   ইচ্ছাকৃত: auth-নির্ভর টেস্ট `next dev` এ চালাতে হয়। লাইভ সাইট
 *   সবসময় https (HSTS preload), তাই সেখানে প্রশ্নই ওঠে না।
 * ═══════════════════════════════════════════════════════════
 */

/**
 * ★ নামের নিয়মটি একটি **বিশুদ্ধ ফাংশন** হিসেবে রাখা হয়েছে।
 *
 *   কেন: টেস্টে "প্রোডাকশনে নাম কী হবে" যাচাই করতে হয়। ফাংশন না
 *   থাকলে টেস্টকে `NODE_ENV` বদলে মডিউল **আবার import** করতে হতো
 *   (`vi.resetModules()`)। এই স্যুট একটি মাত্র fork-এ চলে ও সব
 *   ফাইল একই মডিউল-গ্রাফ ভাগ করে, তাই মাঝপথে গ্রাফ রিসেট করলে
 *   পরের ফাইলগুলো ভিন্ন মডিউল-ইনস্ট্যান্স পেত। বাস্তবে ঠিক তাই
 *   ঘটেছিল: `withdrawal.test.ts` এর `invalidateSettings()` এক
 *   ক্যাশ পরিষ্কার করত আর সার্ভিস অন্য ক্যাশ পড়ত — ৭টি টাকার
 *   টেস্ট মিথ্যা ব্যর্থ হতো।
 *
 *   এখন টেস্ট কেবল `authCookieNames(true)` ডাকে — কোনো env
 *   পরিবর্তন নেই, কোনো মডিউল রিসেট নেই, কোনো পার্শ্বপ্রতিক্রিয়া নেই।
 */
export function authCookieNames(useSecure: boolean) {
  return {
    /** `__Secure-` prefix এর শর্ত: `Secure` অ্যাট্রিবিউট + https */
    session: useSecure ? '__Secure-next-auth.session-token' : 'next-auth.session-token',
    /**
     * `__Host-` prefix এর শর্ত: `Secure`, `Path=/`, এবং `Domain`
     * **অনুপস্থিত**। সবচেয়ে কড়া prefix — subdomain থেকে কুকি
     * বসানো যায় না।
     */
    csrf: useSecure ? '__Host-next-auth.csrf-token' : 'next-auth.csrf-token',
    /** লগইনের পর কোথায় ফিরবে — next-auth নিজে লেখে/পড়ে */
    callback: useSecure ? '__Secure-next-auth.callback-url' : 'next-auth.callback-url',
  };
}

/** প্রোডাকশনে কুকি `Secure` ও prefix-যুক্ত হবে কি না */
export const USE_SECURE_AUTH_COOKIES = process.env.NODE_ENV === 'production';

const NAMES = authCookieNames(USE_SECURE_AUTH_COOKIES);

export const SESSION_COOKIE_NAME = NAMES.session;
export const CSRF_COOKIE_NAME = NAMES.csrf;
export const CALLBACK_COOKIE_NAME = NAMES.callback;
