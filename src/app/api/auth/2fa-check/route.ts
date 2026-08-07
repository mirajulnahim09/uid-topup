import bcrypt from 'bcryptjs';
import { z } from 'zod';
import { prisma } from '@/lib/prisma';
import { apiError, ApiError, readJson } from '@/lib/guard';
import { rateLimit, getIp } from '@/lib/rateLimit';

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
 *   ⚠️ কখনো সেশন তৈরি করে না; শুধু `{ needsTotp: boolean }` ফেরায়।
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

    // ★ login route-এর সমান rate limit — oracle অপব্যবহার ঠেকায়
    const ipLimit = await rateLimit(`2fa-precheck:ip:${ip}`, 10, 600);
    if (!ipLimit.ok) return Response.json({ needsTotp: false });
    const emailLimit = await rateLimit(`2fa-precheck:email:${email}`, 5, 900);
    if (!emailLimit.ok) return Response.json({ needsTotp: false });

    const user = await prisma.user.findUnique({
      where: { email },
      select: { password: true, twoFactorEnabled: true, isBanned: true },
    });

    // ★ timing-safe — ইউজার না থাকলেও bcrypt চালাই
    if (!user) {
      await bcrypt.compare(password, DUMMY_HASH);
      return Response.json({ needsTotp: false });
    }

    const ok = await bcrypt.compare(password, user.password);
    // ★ পাসওয়ার্ড ভুল বা ban — 2FA প্রশ্নই আসে না; login route সামলাবে
    if (!ok || user.isBanned) return Response.json({ needsTotp: false });

    return Response.json({ needsTotp: Boolean(user.twoFactorEnabled) });
  } catch (e) {
    return apiError(e);
  }
}
