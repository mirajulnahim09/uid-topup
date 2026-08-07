import bcrypt from 'bcryptjs';
import { z } from 'zod';
import { prisma } from '@/lib/prisma';
import { requireUser, apiError, ApiError, readJson } from '@/lib/guard';
import { rateLimit, RATE_LIMIT_UNAVAILABLE_MSG } from '@/lib/rateLimit';
import { notify } from '@/lib/notify';
import { adminLog } from '@/lib/adminLog';
import { getIp } from '@/lib/rateLimit';
import { BRAND } from '@/lib/brand';
import { encryptSecret, decryptSecret } from '@/lib/secretbox';
import QRCode from 'qrcode';
import {
  generateTotpSecret, verifyTotp, totpProvisioningUri,
  generateRecoveryCodes, hashRecoveryCode,
} from '@/lib/totp';

export const dynamic = 'force-dynamic';

/**
 * ═══════════════════════════════════════════════════════════
 * ★★★ 2FA ব্যবস্থাপনা (Phase 2)
 *
 *   action=setup    → নতুন secret + QR URI ফেরত (এখনো enabled নয়)
 *   action=enable   → পাসওয়ার্ড + প্রথম TOTP কোড যাচাই → চালু + recovery কোড
 *   action=disable  → পাসওয়ার্ড + কোড যাচাই → বন্ধ
 *
 *   ⚠️ secret DB-তে **এনক্রিপ্টেড** থাকে (secretbox/AES-256-GCM)।
 *   ⚠️ enable করার আগে অবশ্যই একটি বৈধ কোড দিতে হয় — নাহলে ভুল করে
 *      সেটআপ করে অ্যাকাউন্ট থেকে নিজেই লক-আউট হওয়ার ঝুঁকি ছিল।
 *   ⚠️ recovery কোড কেবল enable-এর মুহূর্তে একবারই দেখানো হয় (হ্যাশ রাখা)।
 * ═══════════════════════════════════════════════════════════
 */

const schema = z.object({
  action: z.enum(['setup', 'enable', 'disable']),
  password: z.string().min(1).optional(),
  token: z.string().optional(),
  secret: z.string().optional(), // enable-এ setup থেকে পাওয়া secret ফেরত আসে
});

export async function POST(req: Request) {
  try {
    const user = await requireUser();

    // ★ কোড অনুমান/ব্রুট-ফোর্স ঠেকাতে সীমা
    //   C4: fail-closed — ৬-অঙ্কের TOTP সীমা ছাড়া অনুমানযোগ্য।
    const rl = await rateLimit(`2fa:${user.id}`, 10, 600, { failClosed: true });
    if (!rl.ok) {
      if (rl.failed) throw new ApiError(RATE_LIMIT_UNAVAILABLE_MSG, 503);
      throw new ApiError('অনেক বেশি চেষ্টা। কিছুক্ষণ পর করুন।', 429);
    }

    const parsed = schema.safeParse(await readJson(req));
    if (!parsed.success) throw new ApiError(parsed.error.errors[0].message, 400);
    const { action } = parsed.data;

    const row = await prisma.user.findUnique({
      where: { id: user.id },
      select: { password: true, email: true, twoFactorEnabled: true, twoFactorSecret: true },
    });
    if (!row) throw new ApiError('ইউজার পাওয়া যায়নি', 404);

    // ─────────── SETUP: secret + QR তৈরি (এখনো চালু নয়) ───────────
    if (action === 'setup') {
      if (row.twoFactorEnabled) {
        throw new ApiError('2FA ইতিমধ্যে চালু আছে। আগে বন্ধ করে আবার সেটআপ করুন।', 409);
      }
      const secret = generateTotpSecret();
      const issuer = BRAND.name || 'SS UID TOPUP';
      const uri = totpProvisioningUri(secret, row.email, issuer);
      // ★ QR SVG সার্ভারেই তৈরি (proven qrcode lib) — ক্লায়েন্ট শুধু দেখায়
      const qrSvg = await QRCode.toString(uri, {
        type: 'svg', margin: 2, width: 220,
        color: { dark: '#000000', light: '#ffffff' },
      });
      // ★ secret এখনো DB-তে সংরক্ষণ করি না — enable-এ যাচাইয়ের পর হবে।
      //   ক্লায়েন্ট এটি ধরে রাখে ও enable-এ ফেরত পাঠায়।
      return Response.json({ secret, uri, issuer, qrSvg });
    }

    // enable/disable — পাসওয়ার্ড আবশ্যক (sensitive operation)
    if (!parsed.data.password) {
      throw new ApiError('পাসওয়ার্ড দিন', 400);
    }
    const pwOk = await bcrypt.compare(parsed.data.password, row.password);
    if (!pwOk) throw new ApiError('পাসওয়ার্ড ভুল', 400);

    // ─────────── ENABLE: কোড যাচাই → চালু + recovery কোড ───────────
    if (action === 'enable') {
      if (row.twoFactorEnabled) throw new ApiError('2FA ইতিমধ্যে চালু', 409);
      const secret = parsed.data.secret;
      const token = parsed.data.token;
      if (!secret || !token) throw new ApiError('secret ও কোড দুটোই দিন', 400);

      // ★ defensive — secret অবশ্যই বৈধ base32 (A-Z, 2-7), যথেষ্ট লম্বা।
      //   token verify তো secret দিয়েই হয়, কিন্তু malformed secret DB-তে
      //   গেলে ইউজার স্থায়ীভাবে লক-আউট হতে পারত। এখানে আগেই আটকাই।
      if (!/^[A-Z2-7]{16,}$/.test(secret)) {
        throw new ApiError('secret বৈধ নয় — আবার সেটআপ শুরু করুন', 400);
      }

      // ★ প্রথম কোড অবশ্যই মিলতে হবে — নাহলে লক-আউট
      if (!verifyTotp(secret, token)) {
        throw new ApiError('কোড মেলেনি — Authenticator অ্যাপের ৬-অঙ্কের কোডটি আবার দিন', 400);
      }

      // recovery কোড তৈরি → হ্যাশ রাখি, plaintext একবারই ফেরত
      const recoveryCodes = generateRecoveryCodes(10);
      const recoveryHashes = recoveryCodes.map(hashRecoveryCode);

      await prisma.user.update({
        where: { id: user.id },
        data: {
          twoFactorSecret: encryptSecret(secret),
          twoFactorEnabled: true,
          twoFactorRecovery: JSON.stringify(recoveryHashes),
        },
      });

      adminLog({
        adminId: user.id, adminName: user.name, action: 'TWO_FACTOR_ENABLE',
        detail: '2FA চালু হয়েছে', ip: getIp(req),
      }).catch(() => {});

      notify(
        user.id, '🛡️ 2FA চালু হয়েছে',
        'আপনার অ্যাকাউন্টে দুই-ধাপ যাচাই চালু হয়েছে। recovery কোডগুলো নিরাপদে রাখুন।',
        '/account/profile'
      ).catch(() => {});

      // ★ recovery কোড এই একবারই — এরপর আর দেখানো যাবে না
      return Response.json({ success: true, recoveryCodes });
    }

    // ─────────── DISABLE: কোড যাচাই → বন্ধ ───────────
    if (action === 'disable') {
      if (!row.twoFactorEnabled || !row.twoFactorSecret) {
        throw new ApiError('2FA চালু নেই', 400);
      }
      const token = parsed.data.token;
      if (!token) throw new ApiError('বর্তমান কোড দিন', 400);

      const secret = decryptSecret(row.twoFactorSecret);
      if (!verifyTotp(secret, token)) {
        throw new ApiError('কোড মেলেনি', 400);
      }

      await prisma.user.update({
        where: { id: user.id },
        data: { twoFactorSecret: null, twoFactorEnabled: false, twoFactorRecovery: null },
      });

      adminLog({
        adminId: user.id, adminName: user.name, action: 'TWO_FACTOR_DISABLE',
        detail: '2FA বন্ধ হয়েছে', ip: getIp(req),
      }).catch(() => {});

      notify(
        user.id, '2FA বন্ধ হয়েছে',
        'আপনি না করে থাকলে সাথে সাথে পাসওয়ার্ড বদলান ও সাপোর্টে জানান।',
        '/account/profile'
      ).catch(() => {});

      return Response.json({ success: true });
    }

    throw new ApiError('অজানা অনুরোধ', 400);
  } catch (e) {
    return apiError(e);
  }
}

/** ★ 2FA অবস্থা জানায় (প্রোফাইল পেজে দেখাতে) */
export async function GET() {
  try {
    const user = await requireUser();
    const row = await prisma.user.findUnique({
      where: { id: user.id },
      select: { twoFactorEnabled: true, twoFactorRecovery: true },
    });
    // ★ safe-parse — recovery JSON কোনোভাবে corrupt হলেও status endpoint
    //   যেন না ভাঙে (enabled অবস্থা দেখানো বেশি জরুরি count-এর চেয়ে)।
    let remaining = 0;
    if (row?.twoFactorRecovery) {
      try {
        const arr = JSON.parse(row.twoFactorRecovery);
        if (Array.isArray(arr)) remaining = arr.length;
      } catch { /* corrupt → 0 দেখাই */ }
    }
    return Response.json({
      enabled: Boolean(row?.twoFactorEnabled),
      recoveryRemaining: remaining,
    });
  } catch (e) {
    return apiError(e);
  }
}
