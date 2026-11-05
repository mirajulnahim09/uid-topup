import bcrypt from 'bcryptjs';
import { z } from 'zod';
import { prisma } from '@/lib/prisma';
import { apiError, ApiError, readJson } from '@/lib/guard';
import { rateLimit, refundRateLimit, getIp, LOGIN_LIMITS } from '@/lib/rateLimit';

export const dynamic = 'force-dynamic';

/**
 * ═══════════════════════════════════════════════════════════
 * ★★★ 2FA Pre-check — লগইনের আগে জানায় 2FA লাগবে কিনা
 *
 *   ── কেন দরকার (BUG-fix) ──
 *   NextAuth v4-এ authorize() throw করলে সেই বার্তা ক্লায়েন্টে নির্ভরযোগ্যভাবে
 *   পৌঁছায় না (অনেক setup-এ শুধু "CredentialsSignin" আসে)। তাই "2FA কোড
 *   দিন" স্ক্রিন দেখানোর জন্য throw-এর উপর নির্ভর করা ভঙ্গুর। এই endpoint
 *   deterministic: email+password যাচাই করে বলে দেয় 2FA লাগবে কিনা।
 *
 *   ── নিরাপত্তা ──
 *   ⚠️ এটি password যাচাই করে, তাই brute-force oracle হওয়ার ঝুঁকি ছিল।
 *      প্রতিরোধ: (a) IP+email rate limit (login route-এর মতোই), (b) timing-
 *      safe (ইউজার না থাকলেও bcrypt চালানো)। এটি login-এর অতিরিক্ত ধাপ নয় —
 *      login route নিজেও একই যাচাই করে; এটি কেবল UI-কে জানায় কী দেখাতে হবে।
 *   ⚠️ কখনো সেশন তৈরি করে না; শুধু `{ needsTotp, credentialsOk? }` ফেরায়।
 *
 *   ★★★ AUTH-03 — লগইনের সাথে **একই** বাজেট।
 *   আগে এর নিজস্ব বাকেট (`2fa-precheck:*`) ছিল, অথচ 2FA-অ্যাকাউন্টে
 *   `needsTotp: true` মানেই "পাসওয়ার্ড ঠিক" — ফলে আক্রমণকারী এখানে ৫টি ও
 *   লগইনে আরও ৫টি, অর্থাৎ **দ্বিগুণ** অনুমান পেত। এখন প্রতিটি অনুরোধ লগইনের
 *   `login:ip`/`login:email` বাকেট থেকে **আগেই** একটি চেষ্টা খরচ করে (atomic —
 *   সমান্তরাল অনুমান সীমা পেরোতে পারে না); পাসওয়ার্ড ঠিক হলে খরচটুকু ফেরত।
 *   পাসওয়ার্ড ভুল হলে `credentialsOk: false` — লগইন পাতা তখন `signIn` না
 *   ডেকে একই "ভুল" বার্তা দেখায়, তাই একটি ব্যর্থ চেষ্টা **একবারই** গোনা হয়
 *   (বৈধ ব্যবহারকারীর ৫টি সুযোগ কমে না)। লগইন নিজেও সঠিক/ভুল জানায়, আর
 *   বাজেট এখন একটিই — নতুন কোনো তথ্য ফাঁস হয় না।
 * ═══════════════════════════════════════════════════════════
 */

const DUMMY_HASH = '$2a$12$k8Y1cVvWZ3qJZ9L5oXbGYuJ0mN7pQ2rS4tU6vW8xY0zA1bC3dE5fG';

const schema = z.object({
  email: z.string().trim().toLowerCase().email(),
  password: z.string().min(1),
});

export async function POST(req: Request) {
  try {
    const parsed = schema.safeParse(await readJson(req));
    // ★ ইনপুট ভুল হলেও 2FA লাগে না বলে দিই (তথ্য ফাঁস নয়) — login route
    //   আসল যাচাই করবে
    if (!parsed.success) return Response.json({ needsTotp: false });

    const { email, password } = parsed.data;
    const ip = getIp(req);

    // ★ লগইনের **একই** বাকেট (AUTH-03) — C4: fail-closed।
    //   ⚠️ সীমা/লিমিটার-ব্যর্থতায় `needsTotp: false` (৫০৩ নয়, `credentialsOk` নেই) —
    //   পাতা তখন `signIn` ডাকে, আর `authorize()` (নিজেও fail-closed) সঠিক
    //   "সাময়িক বন্ধ" বার্তার পথে নেয়। এখানে ত্রুটি ছুঁড়লে লগইন ফর্মই ভাঙত।
    const ipKey = `login:ip:${ip}`;
    const emailKey = `login:email:${email}`;
    const ipLimit = await rateLimit(ipKey, LOGIN_LIMITS.ip.limit, LOGIN_LIMITS.ip.window, { failClosed: true });
    if (!ipLimit.ok) return Response.json({ needsTotp: false });
    const emailLimit = await rateLimit(emailKey, LOGIN_LIMITS.email.limit, LOGIN_LIMITS.email.window, { failClosed: true });
    if (!emailLimit.ok) {
      await refundRateLimit(ipKey);
      return Response.json({ needsTotp: false });
    }
    // ★ পাসওয়ার্ড ঠিক হলে খরচ ফেরত — এরপর `signIn` নিজে গুনবে ও সফল হলে ফেরত দেবে
    const refund = async () => { await refundRateLimit(ipKey); await refundRateLimit(emailKey); };

    const user = await prisma.user.findUnique({
      where: { email },
      select: { password: true, twoFactorEnabled: true, isBanned: true },
    });

    // ★ timing-safe — ইউজার না থাকলেও bcrypt চালাই
    if (!user) {
      await bcrypt.compare(password, DUMMY_HASH);
      return Response.json({ needsTotp: false, credentialsOk: false });
    }

    const ok = await bcrypt.compare(password, user.password);
    // ★ পাসওয়ার্ড ভুল — গোনা থাকে; পাতা `signIn` না ডেকে সরাসরি "ভুল" দেখায়
    if (!ok) return Response.json({ needsTotp: false, credentialsOk: false });
    await refund();
    // ★ ban — 2FA প্রশ্নই আসে না; `authorize()` সামলাবে (আগের মতো)
    if (user.isBanned) return Response.json({ needsTotp: false });

    return Response.json({ needsTotp: Boolean(user.twoFactorEnabled) });
  } catch (e) {
    return apiError(e);
  }
}
