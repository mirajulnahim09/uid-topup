/**
 * ★ ডেভ DB-তে একটি গ্রাহক অ্যাকাউন্ট বানায় (শুধু ডেভ)।
 *
 *   কেন দরকার: `dev-db-seed.mjs` কেবল অ্যাডমিন বানায়। মোবাইল
 *   লগইন/ড্যাশবোর্ড যাচাই করতে একজন **সাধারণ** ইউজার লাগে —
 *   অ্যাডমিন দিয়ে পরীক্ষা করলে role-নির্ভর পথগুলো আলাদা হয়ে যায়।
 *
 *   ⚠️ `emailVerified: true` বসানো হয় ইচ্ছাকৃতভাবে — ডেভে ইমেইল
 *   পাঠানো বন্ধ, তাই OTP কখনো আসবে না এবং যাচাই করাও যেত না।
 */
import { PrismaClient } from '@prisma/client';
import bcryptPkg from 'bcryptjs';
const bcrypt = bcryptPkg;

const EMAIL = 'customer@uidtopup.local';
const PASSWORD = 'Customer@2026Secure';

/**
 * ⚠️ URL এখানে **স্পষ্ট করে** লেখা — `.env.development` কেবল Next.js
 *   পড়ে, প্লেইন node স্ক্রিপ্ট নয়। ছেড়ে দিলে Prisma `.env` পড়ত,
 *   যার `DATABASE_URL` লাইভ Neon — অর্থাৎ প্রোডাকশনে ইউজার তৈরি হতো।
 *   (`dev-db-seed.mjs` ঠিক একই কারণে একই কাজ করে।)
 */
const DEV_URL = 'postgresql://dev:dev@localhost:5434/uidtopup_dev';

const db = new PrismaClient({ datasources: { db: { url: DEV_URL } } });
const password = await bcrypt.hash(PASSWORD, 12);

const user = await db.user.upsert({
  where: { email: EMAIL },
  update: { password, isBanned: false, emailVerified: true },
  create: {
    email: EMAIL,
    name: 'টেস্ট গ্রাহক',
    phone: '01700000009',
    password,
    emailVerified: true,
    referralCode: 'DEVCUST1',
    balance: 5000,
  },
});

console.log(`✓ গ্রাহক: ${user.email} / ${PASSWORD}  (ব্যালেন্স ${user.balance})`);
await db.$disconnect();
