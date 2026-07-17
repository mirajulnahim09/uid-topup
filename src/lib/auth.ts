import type { NextAuthOptions } from 'next-auth';
import CredentialsProvider from 'next-auth/providers/credentials';
import GoogleProvider from 'next-auth/providers/google';
import bcrypt from 'bcryptjs';
import { prisma } from './prisma';
import { rateLimit } from './rateLimit';
import { uniqueReferralCode } from './referral';
import { notifyAdmins } from './notify';
import { emailWelcome } from './email';

/**
 * ★ Google দিয়ে সাইন-ইন করা ইউজার DB তে খুঁজে বের করে, না থাকলে তৈরি করে।
 *   phone/password Google দেয় না — তাই unique placeholder phone ও
 *   random password hash বসানো হয় (credentials দিয়ে login করা যাবে না,
 *   শুধু Google দিয়ে)। ইউজার পরে profile এ আসল phone দিতে পারবে।
 */
async function findOrCreateGoogleUser(email: string, name: string) {
  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) return existing;

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
    },
  });

  emailWelcome(created.email, created.name, created.referralCode).catch(() => {});
  notifyAdmins('নতুন রেজিস্ট্রেশন (Google)', `${created.name} Google দিয়ে যোগ দিয়েছে।`, '/admin/users').catch(() => {});
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
            allowDangerousEmailAccountLinking: true,
          }),
        ]
      : []),
    CredentialsProvider({
      name: 'credentials',
      credentials: {
        email: { label: 'Email', type: 'email' },
        password: { label: 'Password', type: 'password' },
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

        const ipLimit = rateLimit(`login:ip:${ip}`, 10, 600);
        if (!ipLimit.ok) {
          console.warn(`[auth] rate limited IP: ${ip}`);
          return null;
        }

        const emailLimit = rateLimit(`login:email:${email}`, 5, 900);
        if (!emailLimit.ok) {
          console.warn(`[auth] rate limited email: ${email}`);
          return null;
        }

        const user = await prisma.user.findUnique({ where: { email } });

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
          select: { id: true, role: true, isBanned: true },
        });
        if (!dbUser || dbUser.isBanned) return {};
        token.id = dbUser.id;
        token.role = dbUser.role;
        return token;
      }

      if (user) {
        token.id = user.id;
        token.role = user.role;
      }

      // ★ প্রতি refresh এ DB থেকে role/ban re-verify
      //   — ban করা ইউজারের পুরনো JWT যেন কাজ না করে
      if (trigger === 'update' || !user) {
        if (!token.id) return {};

        const fresh = await prisma.user.findUnique({
          where: { id: token.id as string },
          select: { role: true, isBanned: true },
        });

        if (!fresh || fresh.isBanned) return {}; // টোকেন বাতিল
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
