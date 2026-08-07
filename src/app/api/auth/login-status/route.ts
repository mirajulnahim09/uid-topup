import { z } from 'zod';
import { apiError, readJson } from '@/lib/guard';
import { peekRateLimit, getIp, LOGIN_LIMITS } from '@/lib/rateLimit';

export const dynamic = 'force-dynamic';

/**
 * ═══════════════════════════════════════════════════════════
 * ★★★ লগইন ব্যর্থ হলে **কেন** — সত্যি কারণটি জানায়
 *
 *   ── কেন দরকার (BUG-fix) ──
 *   `authorize()` তিনটি সম্পূর্ণ ভিন্ন কারণে `null` ফেরত দেয়:
 *     ১. পাসওয়ার্ড ভুল   ২. অ্যাকাউন্ট ব্যান   ৩. **রেট-লিমিট**
 *   NextAuth তিনটিকেই একটিমাত্র `CredentialsSignin` ত্রুটিতে মিলিয়ে
 *   ফেলে, আর UI সেটিকে "ইমেইল বা পাসওয়ার্ড ভুল" লিখে দেখাত।
 *
 *   ফল: সঠিক পাসওয়ার্ড দেওয়া ব্যবহারকারী ভাবতেন পাসওয়ার্ড ভুল হয়েছে,
 *   গিয়ে পাসওয়ার্ড **রিসেট** করতেন — যা সমস্যার সাথে সম্পর্কহীন, আর
 *   প্রতিটি নতুন চেষ্টা সীমাটিকে আরও পিছিয়ে দিত। এই endpoint সেই
 *   ফাঁদটি ভাঙে।
 *
 *   ── নিরাপত্তা ──
 *   ⚠️ কখনো বলে না অ্যাকাউন্ট আছে কি নেই, পাসওয়ার্ড ঠিক ছিল কি না।
 *      কেবল বলে "এই ইমেইল/IP এখন থ্রটল্ড কি না, আর কত সেকেন্ড"।
 *      বাকেট তৈরি হয় ইউজার-লুকআপের **আগে**, তাই অস্তিত্বহীন ইমেইলেও
 *      একই আচরণ — অ্যাকাউন্ট-অস্তিত্ব ফাঁস হয় না।
 *   ⚠️ `peekRateLimit` কেবল SELECT — গণনা বাড়ে না, তাই "কেন আটকালো?"
 *      জিজ্ঞেস করাটাই ব্যবহারকারীকে আরও আটকে দেয় না।
 * ═══════════════════════════════════════════════════════════
 */

const schema = z.object({ email: z.string().trim().toLowerCase().email() });

export async function POST(req: Request) {
  try {
    const parsed = schema.safeParse(await readJson(req));
    if (!parsed.success) return Response.json({ limited: false, retryAfter: 0 });

    const { email } = parsed.data;
    const ip = getIp(req);

    const [byEmail, byIp] = await Promise.all([
      peekRateLimit(`login:email:${email}`, LOGIN_LIMITS.email.limit),
      peekRateLimit(`login:ip:${ip}`, LOGIN_LIMITS.ip.limit),
    ]);

    // যেটির মেয়াদ বেশি বাকি, সেটিই কার্যকর বাধা
    const limited = byEmail.limited || byIp.limited;
    const retryAfter = Math.max(
      byEmail.limited ? byEmail.retryAfter : 0,
      byIp.limited ? byIp.retryAfter : 0,
    );

    return Response.json({
      limited,
      retryAfter,
      scope: byEmail.limited ? 'email' : byIp.limited ? 'ip' : null,
    });
  } catch (e) {
    return apiError(e);
  }
}
