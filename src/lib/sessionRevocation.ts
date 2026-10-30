import { Prisma } from '@prisma/client';
import { prisma } from './prisma';
import { logger } from './logger';

/**
 * ═══════════════════════════════════════════════════════════
 * ★★★ AUTH-05 — প্রতি-সেশন (প্রতি-ডিভাইস) লগআউট
 *
 *   JWT stateless: আগে লগআউট কেবল ওই ব্রাউজারের কুকি মুছত — কপি করা/চুরি হওয়া
 *   কুকি ৩০ দিন `/api/me`-তে ২০০ পেত (মাপা)। এখন প্রতিটি লগইনের টোকেনে একটি
 *   স্থায়ী `sid` থাকে (টোকেন নতুন করে encode হলেও একই — তাই কুকির পুরনো কপিরও
 *   একই `sid`)। লগআউটে **কেবল সেই `sid`** এখানে ওঠে; অন্য ডিভাইস অক্ষত।
 *   "সব ডিভাইস"/পাসওয়ার্ড-রিসেট আগের মতোই `sessionEpoch` দিয়ে।
 *
 *   ⚠️ `sid`-বিহীন পুরনো টোকেন (এই পরিবর্তনের আগের লগইন) আলাদা করে বাতিল করা
 *   যায় না — epoch ও ৩০ দিনের মেয়াদ তাদের ক্ষেত্রে আগের মতোই কাজ করে।
 * ═══════════════════════════════════════════════════════════
 */

/** ★ লগআউট — এই সেশনটি তার মেয়াদ পর্যন্ত বাতিল (একই sid দুবার এলে ক্ষতি নেই) */
export async function revokeSession(sid: string, userId: string, expiresAt: Date): Promise<void> {
  await prisma.revokedSession.upsert({
    where: { sid },
    create: { sid, userId, expiresAt },
    update: {},
  });
}

/**
 * ★ এই সেশন কি লগআউট করা হয়েছে?
 *   ⚠️ টেবিলটিই নেই (P2021 — migration প্রয়োগ হয়নি) হলে: `error` লগ ও readiness-এ
 *   ব্লকার (সেখানে আলাদা যাচাই), কিন্তু প্রতিটি অনুরোধ ৫০০ নয় — নাহলে migration
 *   ছাড়া deploy মানেই পুরো সাইট অচল। epoch/ban-যাচাই তখনো কাজ করে। অন্য যেকোনো
 *   DB-ত্রুটি আগের মতোই উপরে যায় (fail-closed)।
 */
export async function isSessionRevoked(sid: string | undefined): Promise<boolean> {
  if (!sid) return false;
  try {
    const row = await prisma.revokedSession.findUnique({ where: { sid }, select: { sid: true } });
    return row !== null;
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2021') {
      logger.error('auth', 'RevokedSession টেবিল নেই — migration 20260926120000_revoked_sessions প্রয়োগ করুন');
      return false;
    }
    throw e;
  }
}

/** ★ দৈনিক cleanup — মেয়াদোত্তীর্ণ সারি (টোকেন নিজেই তখন অচল) */
export async function cleanupRevokedSessions(): Promise<number> {
  const r = await prisma.revokedSession.deleteMany({ where: { expiresAt: { lt: new Date() } } });
  return r.count;
}

/** ★ readiness — টেবিল আছে কি না (migration প্রয়োগ হয়েছে কি না) */
export async function revokedSessionTableReady(): Promise<boolean> {
  try {
    await prisma.revokedSession.findFirst({ select: { sid: true } });
    return true;
  } catch {
    return false;
  }
}
