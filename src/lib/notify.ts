import { prisma } from './prisma';
import { logger } from './logger';
import { sendTelegramAdmin } from './telegram';
import type { TelegramEvent } from './telegram';

/** In-app notification — কখনো throw করে না, main flow ভাঙবে না */
export async function notify(
  userId: string,
  title: string,
  body: string,
  link?: string
): Promise<void> {
  try {
    await prisma.notification.create({ data: { userId, title, body, link } });
  } catch (e) {
    logger.error('notify', 'in-app notify failed', { err: e });
  }
}

/**
 * ★ সব অ্যাডমিনকে একসাথে নোটিফিকেশন (নতুন অর্ডার/রিচার্জ/রেজিস্ট্রেশন)।
 *   কখনো throw করে না — main flow ভাঙবে না।
 */
export async function notifyAdmins(
  title: string,
  body: string,
  link?: string,
  event?: TelegramEvent,
): Promise<void> {
  // ★ ফিচার ৯ — ইন-অ্যাপ নোটিফিকেশনের পাশাপাশি টেলিগ্রামেও পাঠাই।
  //   fire-and-forget: টেলিগ্রাম ধীর/ব্যর্থ হলেও নিচের DB লেখা আটকাবে না।
  //
  //   `event` দিলে অ্যাডমিনের ইভেন্ট-সুইচ মানা হয়; না দিলে (যেমন
  //   "Google reclaim" — শ্রেণিভুক্ত নয়) শুধু মাস্টার সুইচ দেখে।
  //   ⚠️ ইভেন্ট বন্ধ থাকলেও **ইন-অ্যাপ** নোটিফিকেশন যাবেই — সুইচগুলো
  //   শুধু টেলিগ্রামের, নাহলে অ্যাডমিন প্যানেলে ঘটনা হারিয়ে যেত।
  sendTelegramAdmin(title, body, link, event).catch(() => {});

  try {
    const admins = await prisma.user.findMany({ where: { role: 'ADMIN' }, select: { id: true } });
    if (admins.length === 0) return;
    await prisma.notification.createMany({
      data: admins.map((a: { id: string }) => ({ userId: a.id, title, body, link })),
    });
  } catch (e) {
    logger.error('notify', 'notifyAdmins failed', { err: e });
  }
}

/**
 * ★ স্টক-সতর্কতা (ফিচার ১৪) — কোনো ভ্যারিয়েন্ট শেষ হয়ে গেলে
 *   (stock 0-এ নামলে) অ্যাডমিনদের জানায়, যাতে দ্রুত রিস্টক করা যায়।
 *
 *   অর্ডার সম্পন্ন হওয়ার পর ডাকা হয়। কখনো throw করে না — যদি
 *   নোটিফিকেশন ব্যর্থও হয়, অর্ডার-ফ্লো ভাঙবে না। stock < 0 হলে
 *   (আনলিমিটেড/ম্যানুয়াল) কিছুই করে না।
 */
export async function checkStockAlert(variantId: number): Promise<void> {
  try {
    const v = await prisma.variant.findUnique({
      where: { id: variantId },
      select: { stock: true, label: true, productId: true },
    });
    // stock ঠিক 0 হলেই একবার সতর্ক করি (নেগেটিভ = আনলিমিটেড, তাই বাদ)
    if (!v || v.stock !== 0) return;
    const p = await prisma.product.findUnique({
      where: { id: v.productId },
      select: { name: true },
    });
    await notifyAdmins(
      '⚠️ স্টক শেষ',
      `"${p?.name ?? 'একটি প্রোডাক্ট'} — ${v.label}" এর স্টক শেষ হয়ে গেছে। রিস্টক করুন।`,
      '/admin/products',
      'low_stock',
    );
  } catch (e) {
    logger.error('notify', 'checkStockAlert failed', { err: e });
  }
}
