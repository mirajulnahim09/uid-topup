import type { NextAuthOptions } from 'next-auth';
import { logger } from './logger';
import CredentialsProvider from 'next-auth/providers/credentials';
import GoogleProvider from 'next-auth/providers/google';
import bcrypt from 'bcryptjs';
import { randomUUID } from 'crypto';
import { prisma } from './prisma';
import { rateLimit, resetRateLimit, refundRateLimit, pickIp, LOGIN_LIMITS } from './rateLimit';
import { uniqueReferralCode } from './referral';
import { logActivity } from './adminLog';
import { notifyAdmins } from './notify';
import { emailWelcome } from './email';
import { decryptSecret } from './secretbox';
import { matchTotpStep, hashRecoveryCode } from './totp';
import { claimTotpStep } from './totpReplay';
import { revokeSession, isSessionRevoked } from './sessionRevocation';
import { cleanName } from './sanitize';
import {
  SESSION_COOKIE_NAME,
  CSRF_COOKIE_NAME,
  CALLBACK_COOKIE_NAME,
  USE_SECURE_AUTH_COOKIES,
} from './authCookies';

/**
 * ★ Google দিয়ে সাইন-ইন করা ইউজার DB তে খুঁজে বের করে, না থাকলে তৈরি করে।
 *   phone/password Google দেয় না — তাই unique placeholder phone ও
 *   random password hash বসানো হয় (credentials দিয়ে login করা যাবে না,
 *   শুধু Google দিয়ে)। ইউজার পরে profile এ আসল phone দিতে পারবে।
 */
async function findOrCreateGoogleUser(email: string, name: string) {
  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) {
    // ★★★ C3 — account-takeover পথ বন্ধ।
    //   এই অ্যাপে কোনো database-adapter নেই (JWT strategy), তাই
    //   `allowDangerousEmailAccountLinking` আসলে কিছুই করে না — লিংকিং
    //   এখানেই ম্যানুয়ালি হয়। ঝুঁকি: আক্রমণকারী আগেই victim@gmail-এ
    //   credentials দিয়ে অ্যাকাউন্ট খুলে রাখলে, victim পরে "Google দিয়ে
    //   সাইন-ইন" করলে আক্রমণকারীর অ্যাকাউন্টে ঢুকে যেত — আর আক্রমণকারীর
    //   পাসওয়ার্ড কাজ করতেই থাকত।
    //   সমাধান: Google সাইন-ইন = ইনবক্স-মালিকানার প্রমাণ। বিদ্যমান
    //   অ্যাকাউন্টটি এখনো unverified হলে (credentials-এ তৈরি, কেউ যাচাই
    //   করেনি) এই সাইন-ইনই আসল মালিকের প্রথম প্রমাণ → reclaim: emailVerified
    //   true, আর পুরনো পাসওয়ার্ড একটি random unusable hash দিয়ে বদলে দিই —
    //   ফলে আগের (সম্ভাব্য আক্রমণকারীর) পাসওয়ার্ড আর কাজ করে না।
    //   ⚠️ শুধু credentials-only ইউজার যারা Google ছোঁয় না, তারা সম্পূর্ণ
    //   অপ্রভাবিত (login emailVerified দেখে না)। যিনি Google বেছে নেন, তিনি
    //   চাইলে forgot-password দিয়ে পাসওয়ার্ড আবার সেট করতে পারবেন।
    if (!existing.emailVerified) {
      const lockPass = await bcrypt.hash('google-reclaim-' + Math.random().toString(36).slice(2) + Date.now(), 12);
      // ★★★ `sessionEpoch`-ও বাড়ে — পাসওয়ার্ড বাতিল করা যথেষ্ট ছিল না।
      //   মাপা (EXTREME অডিট, ২০২৬-০৯-২১, `tests/google-reclaim-session`):
      //   আক্রমণকারী আগেই লগইন করে থাকলে reclaim-এর পরেও তাঁর সেশন ২০০
      //   পেত — ৩০ দিন ধরে আসল মালিকের ওয়ালেট দিয়ে অর্ডার করা যেত। পাসওয়ার্ড
      //   রিসেটের মতোই (`api/auth/reset`) এখন অন্য সব সেশন সাথে সাথে বাতিল;
      //   এই Google সেশনটি jwt callback-এ নতুন epoch-ই পায়।
      const reclaimed = await prisma.user.update({
        where: { id: existing.id },
        data: { emailVerified: true, password: lockPass, sessionEpoch: { increment: 1 } },
      });
      // ★ এটি একটি **নিরাপত্তা** ঘটনা: একটি যাচাই-না-হওয়া অ্যাকাউন্টের
      //   মালিকানা বদলে গেছে ও পুরনো পাসওয়ার্ড বাতিল হয়েছে। তাই
      //   security_alert ইভেন্টে যায় — অ্যাডমিন যেন সাথে সাথে জানে।
      notifyAdmins(
        '🛡️ Google reclaim',
        `${email} — যাচাই-না-হওয়া অ্যাকাউন্ট Google মালিকানায় reclaim হয়েছে (পুরনো পাসওয়ার্ড বাতিল)।`,
        '/admin/users',
        'security_alert',
      ).catch(() => {});
      return reclaimed;
    }
    return existing;
  }

  const randomPass = await bcrypt.hash('google-' + Math.random().toString(36).slice(2) + Date.now(), 12);
  const placeholderPhone = 'g-' + Math.random().toString(36).slice(2, 12);
  const referralCode = await uniqueReferralCode();

  const created = await prisma.user.create({
    data: {
      email,
      // ★ Google-এর নাম বাইরের ইনপুট — credentials পথের মতোই পরিষ্কার করি।
      //   আগে কাঁচা অবস্থায় বসত, অথচ নামটি ইমেইল-টেমপ্লেট ও টেলিগ্রাম
      //   বার্তায় HTML হিসেবে যায় (চূড়ান্ত অডিট, মালিকের অনুমোদনে)।
      name: cleanName(name, 60) || email.split('@')[0],
      phone: placeholderPhone,
      password: randomPass,
      referralCode,
      emailVerified: true, // ★ Google ইনবক্স যাচাই করে দিয়েছে
    },
  });

  emailWelcome(created.email, created.name, created.referralCode).catch(() => {});
  notifyAdmins('নতুন রেজিস্ট্রেশন (Google)', `${created.name} Google দিয়ে যোগ দিয়েছে।`, '/admin/users', 'user_registered').catch(() => {});
  return created;
}

/**
 * ★ ডামি হ্যাশ — টাইমিং অ্যাটাক প্রতিরোধ।
 *
 *   সমস্যা: ইউজার না থাকলে সাথে সাথে null ফেরত যেত (~1ms),
 *   কিন্তু থাকলে bcrypt চলত (~100ms)। এই সময়ের পার্থক্য দেখে
 *   আক্রমণকারী বুঝে ফেলত কোন ইমেইলগুলো আসল — তারপর সেগুলোতে
 *   পাসওয়ার্ড ব্রুট-ফোর্স করত।
 *
 *   সমাধান: ইউজার না থাকলেও একটা ডামি হ্যাশের সাথে compare চালাই।
 *   দুই ক্ষেত্রেই সময় একই লাগে।
 */
const DUMMY_HASH = '$2a$12$k8Y1cVvWZ3qJZ9L5oXbGYuJ0mN7pQ2rS4tU6vW8xY0zA1bC3dE5fG';

/**
 * ★ C5 — কত পর পর DB থেকে ban/epoch পুনঃযাচাই হবে।
 *   ৫ মিনিট = ব্যান কার্যকর হওয়ার সর্বোচ্চ বিলম্ব। কমালে DB-চাপ বাড়ে,
 *   বাড়ালে ব্যান করা ইউজার বেশিক্ষণ ঢুকতে পারেন।
 */
export const SESSION_REVALIDATE_MS = 5 * 60 * 1000;

export const authOptions: NextAuthOptions = {
  session: { strategy: 'jwt', maxAge: 30 * 24 * 60 * 60 },
  // `error` too: without it a refused Google sign-in (2FA account, banned) or a
  // provider/config failure landed on NextAuth's unstyled English error page.
  // `/login` reads `?error=` and shows a Bangla message (authErrorMessage).
  pages: { signIn: '/login', error: '/login' },

  // ★ অডিট: লগইন/লগআউট রেকর্ড (best-effort — auth flow ভাঙে না)।
  //   IP/device এখানে পাওয়া যায় না (NextAuth event req দেয় না), তাই
  //   "if available" নিয়ম মেনে সেগুলো ফাঁকা থাকে।
  events: {
    async signIn({ user }) {
      const u = user as { id?: string; name?: string; role?: string };
      logActivity({
        actorId: u.id || 'unknown', actorName: u.name || 'ব্যবহারকারী',
        actorType: u.role === 'ADMIN' ? 'ADMIN' : 'CUSTOMER', role: u.role || 'USER',
        action: 'LOGIN',
      }).catch(() => {});
    },
    async signOut({ token }) {
      const t = token as { id?: string; name?: string; role?: string; sid?: string; exp?: number } | null;
      /**
       * ★★★ AUTH-05 — **কেবল এই সেশনটি** বাতিল (অন্য ডিভাইস অক্ষত)।
       *   কুকি মোছা যথেষ্ট ছিল না — কপি করা কুকি ৩০ দিন চলত। মেয়াদ = টোকেনের
       *   নিজের `exp`; তারপর সারিটি অর্থহীন। ব্যর্থ হলে লগ — কুকি তবু মুছে যায়।
       */
      if (t?.id && t.sid) {
        const expiresAt = new Date(typeof t.exp === 'number' ? t.exp * 1000 : Date.now() + 30 * 24 * 60 * 60 * 1000);
        await revokeSession(t.sid, t.id, expiresAt)
          .catch((e) => logger.error('auth', 'সেশন বাতিল-তালিকায় তোলা যায়নি', { err: e }));
      }
      if (t?.id) {
        logActivity({
          actorId: t.id, actorName: t.name || 'ব্যবহারকারী',
          actorType: t.role === 'ADMIN' ? 'ADMIN' : 'CUSTOMER', role: t.role || 'USER',
          action: 'LOGOUT',
        }).catch(() => {});
      }
    },
  },

  /**
   * ★ কুকি নিরাপত্তা
   *
   *   নামগুলো `authCookies.ts` থেকে আসে — `middleware.ts` ও ঠিক সেই
   *   ফাইল থেকেই পড়ে। আগে নাম দুই জায়গায় দুইভাবে ঠিক হতো এবং লাইভ
   *   সাইটে অমিল হয়ে প্রতিটি সুরক্ষিত রুট `/login` এ ফেরত পাঠাত;
   *   বিস্তারিত ওই ফাইলের মাথায়।
   *
   *   ★ csrfToken ও callbackUrl আগে **override করা হতো না**, তাই
   *   next-auth সেগুলোর নাম/`secure` ঠিক করত `NEXTAUTH_URL` দেখে।
   *   লাইভে সেটি https না হওয়ায় দুটোই `Secure` ছাড়া যেত — অর্থাৎ
   *   প্রোডাকশনে অ-নিরাপদ কুকি। এখন তিনটিই একই নিয়মে চলে।
   */
  cookies: {
    sessionToken: {
      name: SESSION_COOKIE_NAME,
      options: {
        httpOnly: true,   // JavaScript পড়তে পারবে না (XSS হলেও টোকেন চুরি হবে না)
        sameSite: 'lax',  // CSRF প্রতিরোধ
        path: '/',
        secure: USE_SECURE_AUTH_COOKIES, // শুধু HTTPS
      },
    },
    csrfToken: {
      name: CSRF_COOKIE_NAME,
      options: {
        httpOnly: true,
        sameSite: 'lax',
        // ⚠️ `__Host-` prefix এর শর্ত — path অবশ্যই '/', domain অনুপস্থিত
        path: '/',
        secure: USE_SECURE_AUTH_COOKIES,
      },
    },
    callbackUrl: {
      name: CALLBACK_COOKIE_NAME,
      options: {
        httpOnly: true,
        sameSite: 'lax',
        path: '/',
        secure: USE_SECURE_AUTH_COOKIES,
      },
    },
  },

  providers: [
    ...(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET
      ? [
          GoogleProvider({
            clientId: process.env.GOOGLE_CLIENT_ID,
            clientSecret: process.env.GOOGLE_CLIENT_SECRET,
            // ★ C3 — নিরাপদ ডিফল্ট। (এই অ্যাপে adapter নেই বলে এটি কার্যত
            //   no-op, তবু intent স্পষ্ট রাখতে false; আসল takeover-গার্ড
            //   findOrCreateGoogleUser এর reclaim যুক্তিতে।)
            allowDangerousEmailAccountLinking: false,
          }),
        ]
      : []),
    CredentialsProvider({
      name: 'credentials',
      credentials: {
        email: { label: 'Email', type: 'email' },
        password: { label: 'Password', type: 'password' },
        // ★ 2FA — চালু থাকলে এই ৬-অঙ্কের কোড (বা recovery কোড) লাগে
        totp: { label: 'Authenticator Code', type: 'text' },
      },

      async authorize(creds, req) {
        if (!creds?.email || !creds?.password) return null;

        const email = String(creds.email).toLowerCase().trim();
        const password = String(creds.password);

        // ★★★ BRUTE-FORCE গার্ড
        //     একই IP থেকে ১০ মিনিটে সর্বোচ্চ ১০ বার লগইন চেষ্টা।
        //     একই ইমেইলে ১৫ মিনিটে সর্বোচ্চ ৫ বার।
        // ★★★ H2 — শেয়ার্ড `pickIp()`। আগে এখানে আলাদা কপি ছিল যা
        //   `x-forwarded-for` নিঃশর্তে পড়ত, অর্থাৎ যে কেউ প্রতিটি
        //   চেষ্টায় নতুন IP দাবি করে `login:ip:*` সীমা বাইপাস করতে
        //   পারত। এখন `TRUSTED_PROXY` না থাকলে ওই হেডার উপেক্ষিত।
        const ip = pickIp((n) => req?.headers?.[n] as string | undefined);

        // ★★★ C4 — অথ-পথে fail-closed। লিমিটারের DB কল ব্যর্থ হলে
        //   আগে `ok: true` ফিরত, অর্থাৎ ডাটাবেস চাপে পড়লেই ব্রুট-ফোর্স
        //   গার্ড উধাও হয়ে যেত। এখন ব্যর্থ হলে লগইন আটকে যায়।
        const ipLimit = await rateLimit(
          `login:ip:${ip}`, LOGIN_LIMITS.ip.limit, LOGIN_LIMITS.ip.window, { failClosed: true },
        );
        if (!ipLimit.ok) {
          logger.warn('auth', ipLimit.failed ? 'limiter unavailable — blocking (IP)' : 'rate limited IP', { ip });
          return null;
        }

        const emailLimit = await rateLimit(
          `login:email:${email}`, LOGIN_LIMITS.email.limit, LOGIN_LIMITS.email.window, { failClosed: true },
        );
        if (!emailLimit.ok) {
          logger.warn('auth', emailLimit.failed ? 'limiter unavailable — blocking (email)' : 'rate limited email', { email });
          return null;
        }

        const user = await prisma.user.findUnique({
          where: { email },
          select: {
            id: true, name: true, email: true, password: true, role: true,
            isBanned: true, twoFactorEnabled: true, twoFactorSecret: true,
            twoFactorRecovery: true,
          },
        });

        // ★ টাইমিং অ্যাটাক প্রতিরোধ — ইউজার না থাকলেও bcrypt চালাই
        if (!user) {
          await bcrypt.compare(password, DUMMY_HASH);
          return null;
        }

        if (user.isBanned) {
          await bcrypt.compare(password, DUMMY_HASH); // সময় একই রাখি
          return null;
        }

        const ok = await bcrypt.compare(password, user.password);
        if (!ok) return null;

        // ═══════ 2FA GATE (Phase 2) ═══════
        // ★ 2FA চালু থাকলে পাসওয়ার্ড ঠিক হলেও কোড ছাড়া ঢুকতে দেওয়া যাবে না।
        //   ৬-অঙ্কের TOTP কোড, অথবা একটি এককালীন recovery কোড গ্রহণযোগ্য।
        //   ⚠️ NextAuth ভুল কারণ আলাদা করে দেখাতে পারে না (সব null → একই
        //     বার্তা)। তাই ক্লায়েন্ট আগে জানতে চায় 2FA লাগবে কিনা — সেটি
        //     handle করতে একটি হালকা signal: কোড না দিলে বিশেষ থ্রো।
        if (user.twoFactorEnabled && user.twoFactorSecret) {
          const code = String(creds.totp || '').replace(/\s/g, '');
          if (!code) {
            // ★ ক্লায়েন্টকে জানানোর উপায় — বিশেষ বার্তা সহ null নয়, throw।
            //   (মূল পথ: login page আগে /api/auth/2fa-check ডাকে; এটি fallback।)
            throw new Error('2FA_REQUIRED');
          }

          // ★★★ decrypt fail-safe — এনক্রিপশন কী বদলালে/secret corrupt হলে
          //   decryptSecret throw করত → authorize throw → ইউজার স্থায়ীভাবে
          //   লক-আউট (recovery কোড দিয়েও না, কারণ throw আগেই হতো)। এখন
          //   decrypt ব্যর্থ হলে TOTP বাদ, কিন্তু recovery কোড পথ খোলা থাকে।
          let passed = false;
          try {
            const secret = decryptSecret(user.twoFactorSecret);
            // ★★★ AUTH-06 — কোড মিললেও ধাপটি আগে ব্যবহৃত হলে (replay) গ্রহণ নয়
            const step = matchTotpStep(secret, code);
            passed = step !== null && (await claimTotpStep(user.id, step));
          } catch {
            logger.error('auth', '2FA secret decrypt failed (key rotated?)', { userId: user.id });
            // passed=false — নিচে recovery কোড চেষ্টা হবে
          }

          // ★ TOTP না মিললে (বা decrypt ব্যর্থ) recovery কোড চেষ্টা করি (এককালীন)
          if (!passed && user.twoFactorRecovery) {
            const h = hashRecoveryCode(code);
            try {
              // ★★★ RACE-SAFE consume — read-modify-write একটি transaction-এ,
              //   রো explicit lock করে। আগে lock ছাড়া ছিল, তাই একই recovery
              //   কোড নিয়ে দুটো login একসাথে এলে দুটোই pass করত (double-use)।
              //   এখন lock-এর ভেতরে আবার পড়ি → এখনও থাকলেই কেবল remove ও pass।
              const consumed = await prisma.$transaction(async (tx) => {
                const locked = await tx.$queryRaw<{ twoFactorRecovery: string | null }[]>`
                  SELECT "twoFactorRecovery" FROM "User" WHERE id = ${user.id} FOR UPDATE`;
                const current = locked[0]?.twoFactorRecovery;
                if (!current) return false;
                const hashes = JSON.parse(current) as string[];
                const idx = hashes.indexOf(h);
                if (idx === -1) return false; // অন্য request আগে ব্যবহার করে ফেলেছে
                const remaining = hashes.filter((_, i) => i !== idx);
                await tx.user.update({
                  where: { id: user.id },
                  data: { twoFactorRecovery: JSON.stringify(remaining) },
                });
                return remaining.length; // সংখ্যা ফেরত = সফল
              });

              if (consumed !== false) {
                passed = true;
                logActivity({
                  actorId: user.id, actorName: user.name,
                  actorType: user.role === 'ADMIN' ? 'ADMIN' : 'CUSTOMER',
                  role: user.role, action: 'TWO_FACTOR_RECOVERY_USED',
                  detail: `recovery কোড ব্যবহৃত (বাকি ${consumed})`,
                }).catch(() => {});
              }
            } catch { /* corrupt JSON বা DB সমস্যা — উপেক্ষা, TOTP-ই একমাত্র পথ */ }
          }

          if (!passed) {
            // ★ ভুল কোড — rate limit ইতিমধ্যে উপরে গোনা হয়েছে
            logger.warn('auth', '2FA code failed', { userId: user.id });
            return null;
          }
        }

        // ★★★ সফল প্রমাণীকরণ → ইমেইল-বাকেট পরিষ্কার।
        //   ব্রুট-ফোর্স গার্ড **ব্যর্থ** চেষ্টা গোনার জন্য। সফল লগইনও
        //   গোনা হলে বৈধ ব্যবহারকারী নিজের সফল লগইন দিয়েই নিজেকে
        //   লক-আউট করতেন — বাস্তবে ঠিক তাই ঘটেছিল (৫টি সফল লগইনের
        //   পর ষষ্ঠটি "ইমেইল বা পাসওয়ার্ড ভুল" দেখাত)।
        //   ⚠️ IP-বাকেট ইচ্ছাকৃতভাবে **মোছা হয় না** — একটি বৈধ অ্যাকাউন্ট
        //   হাতে থাকলে আক্রমণকারী নাহলে বারবার লগইন করে IP-কোটা রিসেট
        //   করে অন্য অ্যাকাউন্টে ব্রুট-ফোর্স চালাতে পারত।
        //   ★ তবে এই সফল চেষ্টার **নিজের** গণনাটুকু ফেরত (−১) — চূড়ান্ত মাস্টার
        //   অডিট (২০২৬-০৯-১৭), মালিকের সিদ্ধান্ত: একই carrier-IP (CGNAT)-এর
        //   পেছনের সফল লগইনগুলো আর একে অপরকে আটকায় না; ব্যর্থগুলো গোনা থাকে।
        await resetRateLimit(`login:email:${email}`);
        await refundRateLimit(`login:ip:${ip}`);

        return {
          id: user.id,
          name: user.name,
          email: user.email,
          role: user.role,
        };
      },
    }),
  ],

  callbacks: {
    // ★ Google সাইন-ইন হলে DB তে ইউজার তৈরি/লিংক
    async signIn({ account, profile, user }) {
      if (account?.provider === 'google') {
        const email = (profile?.email || user?.email || '').toLowerCase().trim();
        if (!email) return false;
        const dbUser = await findOrCreateGoogleUser(email, profile?.name || user?.name || '');
        if (dbUser.isBanned) return false; // ব্যান/সাসপেন্ড হলে ঢুকতে দেবে না
        // Google proves inbox ownership, not the TOTP second factor. A 2FA
        // account (admins above all) must sign in through credentials,
        // where the code is demanded; otherwise Google bypasses 2FA.
        if (dbUser.twoFactorEnabled) return false;
        return true;
      }
      return true;
    },

    async jwt({ token, user, account, trigger }) {
      // ★ Google — DB ইউজারের আসল id/role টোকেনে বসাই (Google এর sub নয়)
      if (account?.provider === 'google' && (user?.email || token.email)) {
        const email = String(user?.email || token.email).toLowerCase().trim();
        const dbUser = await prisma.user.findUnique({
          where: { email },
          select: { id: true, role: true, isBanned: true, sessionEpoch: true },
        });
        if (!dbUser || dbUser.isBanned) return {};
        token.id = dbUser.id;
        token.role = dbUser.role;
        token.epoch = dbUser.sessionEpoch ?? 0;
        token.lastChecked = Date.now();   // C5 — এইমাত্র DB দেখা হলো
        token.sid = randomUUID();          // AUTH-05 — এই লগইনের স্থায়ী সেশন-id
        return token;
      }

      if (user) {
        token.id = user.id;
        token.role = user.role;
        // ★ লগইনের মুহূর্তের session epoch — পরে DB-র epoch বাড়লে এই
        //   টোকেন বাসি হয়ে যাবে ("সব ডিভাইস সাইন-আউট")
        const withEpoch = await prisma.user.findUnique({
          where: { id: user.id }, select: { sessionEpoch: true },
        });
        token.epoch = withEpoch?.sessionEpoch ?? 0;
        token.lastChecked = Date.now();   // এইমাত্র DB দেখা হলো
        // ★ AUTH-05 — এই লগইনের স্থায়ী সেশন-id: টোকেন পরে নতুন করে encode হলেও
        //   (rolling) একই থাকে, তাই লগআউটে এটি বাতিল করলে কুকির পুরনো কপিও বাতিল
        token.sid = randomUUID();
        return token;
      }

      /**
       * ★★★ C5 — ban / epoch পুনঃযাচাই, কিন্তু **থ্রটল করে**।
       *
       *   আগের শর্ত ছিল `trigger === 'update' || !user`। লগইনের পর
       *   প্রায় প্রতিটি অনুরোধেই `user` থাকে না, অর্থাৎ শর্তটি কার্যত
       *   **সবসময়** সত্য — প্রতিটি সেশন-পাঠে একটি করে DB কোয়েরি যেত।
       *   Neon-এ সংযোগ-সীমা ও auto-suspend থাকায় সেটি বাস্তব খরচ।
       *
       *   অন্যদিকে `middleware.ts` কেবল স্বাক্ষরিত JWT-র দাবি পড়ে
       *   (`getToken` — jwt callback চালায় না), তাই ব্যান করা ইউজার
       *   middleware পার হয়ে যেত; আসল বাধা ছিল `requireUser()`।
       *
       *   সমাধান: `lastChecked` দাবি। ৫ মিনিটের বেশি পুরনো হলে তবেই
       *   DB দেখা হয়। ফলে —
       *     · ব্যান কার্যকর হতে **সর্বোচ্চ ৫ মিনিট** লাগে
       *     · স্বাভাবিক ট্রাফিকে DB কোয়েরি নাটকীয়ভাবে কমে
       *     · middleware-এ কোনো DB কল যোগ হয়নি (edge-এ চলে)
       *
       *   ⚠️ পুরনো টোকেনে `lastChecked` নেই → সাথে সাথে যাচাই হয়।
       *      এটি লগ-আউট নয়, কেবল একবার DB দেখা — তাই ইতিমধ্যে
       *      লগইন থাকা কেউ এই পরিবর্তনে বেরিয়ে যাবেন না।
       */
      const last = typeof token.lastChecked === 'number' ? token.lastChecked : 0;
      const stale = Date.now() - last > SESSION_REVALIDATE_MS;

      if (trigger === 'update' || stale) {
        if (!token.id) return {};

        const fresh = await prisma.user.findUnique({
          where: { id: token.id as string },
          select: { role: true, isBanned: true, sessionEpoch: true },
        });

        if (!fresh || fresh.isBanned) return {}; // টোকেন বাতিল
        // ★★★ epoch mismatch = এই টোকেন revoke করা হয়েছে
        if ((token.epoch ?? 0) !== fresh.sessionEpoch) return {};
        // ★ AUTH-05 — এই সেশনটি লগআউট করা হয়েছে
        if (await isSessionRevoked(token.sid)) return {};
        token.role = fresh.role;
        token.lastChecked = Date.now();
      }

      return token;
    },

    async session({ session, token }) {
      /**
       * ★★★ C5 — টোকেন বাতিল হলে (ban / delete / epoch অমিল) jwt
       *   callback খালি `{}` ফেরত দেয়। আগে এখানে সেই ক্ষেত্রে
       *   `session` **যেমন আছে তেমনই** ফেরত যেত — অর্থাৎ একটি
       *   `user.id`-বিহীন কিন্তু **truthy** সেশন।
       *
       *   ফল: `requireUser()` ঠিকই আটকাত (সে `session?.user?.id`
       *   দেখে), কিন্তু যেসব server component কেবল `if (!session)`
       *   দেখে, তারা রেন্ডার করে ফেলত। মাপা হয়েছে — কোনো তথ্য
       *   ফাঁস হতো না (id undefined বলে কোয়েরি খালি ফিরত), তবু
       *   ব্যান করা ব্যবহারকারী লগইনে না গিয়ে একটি ফাঁকা অ্যাকাউন্ট
       *   পাতা দেখতেন।
       *
       *   এখন `null` ফেরত যায় — `getServerSession()` তখন `null` দেয়,
       *   তাই `if (!session)` লেখা প্রতিটি পাতা একবারেই সঠিক আচরণ করে।
       *   ⚠️ NextAuth-এর টাইপ `Session` চায়, কিন্তু `getServerSession`
       *   এর নিজের রিটার্ন টাইপ `Session | null` — তাই cast নিরাপদ।
       */
      if (!token?.id) return null as unknown as typeof session;

      session.user.id = token.id as string;
      session.user.role = token.role as 'USER' | 'ADMIN';
      /**
       * ★★★ টোকেনের session-যুগ সেশনেও — যাতে **প্রতিটি API অনুরোধে**
       *   `requireUser()` DB-র `sessionEpoch`-এর সাথে মিলিয়ে দেখতে পারে।
       *
       *   ⚠️ কেন দরকার (EXTREME অডিটে মাপা, ২০২৬-০৯-১৮): epoch যাচাই হতো
       *   কেবল এই jwt callback-এ, আর সেটি খরচ বাঁচাতে **৫ মিনিটে একবার**
       *   (`lastChecked`)। ফলে "সব ডিভাইস থেকে সাইন-আউট" বা পাসওয়ার্ড-রিসেটের
       *   পরেও চুরি হওয়া সেশন **৩০১ সেকেন্ড** পর্যন্ত অর্ডার/প্রত্যাহার করতে
       *   পারত (মাপা)। ব্যান সাথে সাথে কাজ করত, কারণ সেটি `requireUser()`
       *   প্রতিবার DB থেকে পড়ে — epoch-ও এখন সেই একই কোয়েরিতে মেলে।
       */
      session.user.epoch = (token.epoch as number | undefined) ?? 0;
      // ★ AUTH-05 — `requireUser()`/পাতা-গার্ড প্রতিবার বাতিল-তালিকায় মেলায়
      session.user.sid = token.sid;
      return session;
    },
  },

  secret: process.env.NEXTAUTH_SECRET,
};
