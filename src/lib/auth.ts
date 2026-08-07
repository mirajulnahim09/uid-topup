import type { NextAuthOptions } from 'next-auth';
import { logger } from './logger';
import CredentialsProvider from 'next-auth/providers/credentials';
import GoogleProvider from 'next-auth/providers/google';
import bcrypt from 'bcryptjs';
import { prisma } from './prisma';
import { rateLimit, resetRateLimit, LOGIN_LIMITS } from './rateLimit';
import { uniqueReferralCode } from './referral';
import { logActivity } from './adminLog';
import { notifyAdmins } from './notify';
import { emailWelcome } from './email';
import { decryptSecret } from './secretbox';
import { verifyTotp, hashRecoveryCode } from './totp';

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
      const reclaimed = await prisma.user.update({
        where: { id: existing.id },
        data: { emailVerified: true, password: lockPass },
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
      name: name || email.split('@')[0],
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

export const authOptions: NextAuthOptions = {
  session: { strategy: 'jwt', maxAge: 30 * 24 * 60 * 60 },
  pages: { signIn: '/login' },

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
      const t = token as { id?: string; name?: string; role?: string } | null;
      if (t?.id) {
        logActivity({
          actorId: t.id, actorName: t.name || 'ব্যবহারকারী',
          actorType: t.role === 'ADMIN' ? 'ADMIN' : 'CUSTOMER', role: t.role || 'USER',
          action: 'LOGOUT',
        }).catch(() => {});
      }
    },
  },

  // ★ কুকি নিরাপত্তা
  cookies: {
    sessionToken: {
      name:
        process.env.NODE_ENV === 'production'
          ? '__Secure-next-auth.session-token'
          : 'next-auth.session-token',
      options: {
        httpOnly: true,   // JavaScript পড়তে পারবে না (XSS হলেও টোকেন চুরি হবে না)
        sameSite: 'lax',  // CSRF প্রতিরোধ
        path: '/',
        secure: process.env.NODE_ENV === 'production', // শুধু HTTPS
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
        const ip =
          (req?.headers?.['x-real-ip'] as string) ||
          (req?.headers?.['cf-connecting-ip'] as string) ||
          (req?.headers?.['x-forwarded-for'] as string)?.split(',')[0]?.trim() ||
          'unknown';

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
            passed = verifyTotp(secret, code);
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
        //   ⚠️ IP-বাকেট ইচ্ছাকৃতভাবে **রাখা হয়** — একটি বৈধ অ্যাকাউন্ট
        //   হাতে থাকলে আক্রমণকারী নাহলে বারবার লগইন করে IP-কোটা রিসেট
        //   করে অন্য অ্যাকাউন্টে ব্রুট-ফোর্স চালাতে পারত।
        await resetRateLimit(`login:email:${email}`);

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
      }

      // ★ প্রতি refresh এ DB থেকে role/ban + session epoch re-verify
      //   — ban করা ইউজার বা "সব ডিভাইস সাইন-আউট" করা টোকেন যেন না চলে
      if (trigger === 'update' || !user) {
        if (!token.id) return {};

        const fresh = await prisma.user.findUnique({
          where: { id: token.id as string },
          select: { role: true, isBanned: true, sessionEpoch: true },
        });

        if (!fresh || fresh.isBanned) return {}; // টোকেন বাতিল
        // ★★★ epoch mismatch = এই টোকেন revoke করা হয়েছে
        if ((token.epoch ?? 0) !== fresh.sessionEpoch) return {};
        token.role = fresh.role;
      }

      return token;
    },

    async session({ session, token }) {
      // ★ টোকেন বাতিল হলে (ban/delete) jwt callback খালি {} ফেরত দেয়।
      //   তখন session.user এ id বসাই না — middleware ও requireUser()
      //   দুই জায়গাতেই আটকে যাবে।
      if (!token?.id) return session;

      session.user.id = token.id as string;
      session.user.role = token.role as 'USER' | 'ADMIN';
      return session;
    },
  },

  secret: process.env.NEXTAUTH_SECRET,
};
