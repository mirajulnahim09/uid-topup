/**
 * ═══════════════════════════════════════════════════════════
 * ★ টেস্ট ডেটা ফ্যাক্টরি (Group D)
 *
 *   প্রতিটি টেস্টের আগে সব টেবিল truncate হয় (vitest.setup.ts), তাই
 *   প্রতিটি টেস্ট নিজের ডেটা নিজেই বানায় — কোনো ভাগ করা fixture নেই।
 *   ফলে টেস্টের ক্রম বদলালেও ফল বদলায় না।
 *
 *   ⚠️ ব্যালেন্স এখানে সরাসরি `balance` ফিল্ডে বসানো হয় — খতিয়ান
 *   ছাড়াই। এটি ইচ্ছাকৃত: এটি টেস্টের **শুরুর অবস্থা**, কোনো লেনদেন
 *   নয়। খতিয়ান-invariant টেস্ট তাই ০-ব্যালেন্স ইউজার দিয়ে শুরু করে
 *   এবং কেবল অ্যাপের লেখা এন্ট্রিগুলো মেলায়।
 * ═══════════════════════════════════════════════════════════
 */
import bcrypt from 'bcryptjs';
import type { PrismaClient } from '@prisma/client';

/** ★ cost 10 — auth.ts যেকোনো cost যাচাই করতে পারে, কম মানে টেস্ট দ্রুত */
const BCRYPT_COST = 10;

export const DEFAULT_PASSWORD = 'TestPass!234';

let seq = 0;
const uniq = () => `${Date.now().toString(36)}${(seq++).toString(36)}`;

/**
 * ★ অনন্য ও বৈধ BD মোবাইল নম্বর।
 *   `User.phone` স্কিমায় `@unique`, আর কিছু ভ্যালিডেটর
 *   `^01[3-9]\d{8}$` চায় — তাই "019" + ৮ অঙ্কের ক্রমিক সংখ্যা।
 *   ⚠️ এলোমেলো/টাইমস্ট্যাম্প-ভিত্তিক নম্বর একই মিলিসেকেন্ডে দুজন
 *   ইউজার বানালে সংঘর্ষ করত; ক্রমিক কাউন্টার কখনো করে না।
 */
let phoneSeq = 0;
const nextPhone = () => `019${String(phoneSeq++).padStart(8, '0')}`;

export async function createUser(
  db: PrismaClient,
  opts: {
    email?: string;
    password?: string;
    balance?: number;
    role?: 'USER' | 'ADMIN';
    isBanned?: boolean;
    name?: string;
  } = {},
) {
  const tag = uniq();
  const password = opts.password ?? DEFAULT_PASSWORD;

  const user = await db.user.create({
    data: {
      email: opts.email ?? `u${tag}@test.local`,
      name: opts.name ?? `Test User ${tag}`,
      phone: nextPhone(),
      password: await bcrypt.hash(password, BCRYPT_COST),
      referralCode: `REF${tag.toUpperCase()}`.slice(0, 16),
      balance: opts.balance ?? 0,
      role: opts.role ?? 'USER',
      isBanned: opts.isBanned ?? false,
    },
  });

  return { ...user, plainPassword: password };
}

export async function createAdmin(db: PrismaClient, opts: { balance?: number } = {}) {
  return createUser(db, { ...opts, role: 'ADMIN', name: 'Test Admin' });
}

/**
 * ★ একটি সম্পূর্ণ ক্যাটালগ শাখা: Category → Product → Variant।
 *   অর্ডার রুট `variant.product.isActive` দেখে, তাই তিনটিই লাগে।
 */
export async function createVariant(
  db: PrismaClient,
  opts: {
    price?: number; stock?: number; costPrice?: number; isActive?: boolean;
    /** ★ Group F — `undefined` = ছাড় নেই (null), `0` = সত্যিই ফ্রি */
    resellerPrice?: number;
  } = {},
) {
  const tag = uniq();
  const category = await db.category.create({
    data: { name: `Cat ${tag}`, slug: `cat-${tag}` },
  });
  const product = await db.product.create({
    data: {
      categoryId: category.id,
      name: `Product ${tag}`,
      slug: `product-${tag}`,
      isActive: true,
    },
  });
  return db.variant.create({
    data: {
      productId: product.id,
      label: `Variant ${tag}`,
      price: opts.price ?? 100,
      costPrice: opts.costPrice ?? 60,
      resellerPrice: opts.resellerPrice ?? null,
      // ★ ডিফল্ট -1 = সীমাহীন স্টক (স্কিমার নিজস্ব ডিফল্ট)
      stock: opts.stock ?? -1,
      isActive: opts.isActive ?? true,
    },
    include: { product: true },
  });
}

export async function createCoupon(
  db: PrismaClient,
  opts: {
    code?: string;
    type?: 'PERCENT' | 'FIXED';
    value?: number;
    usageLimit?: number | null;
    perUserLimit?: number;
    minOrder?: number;
    maxDiscount?: number | null;
  } = {},
) {
  return db.coupon.create({
    data: {
      code: (opts.code ?? `SAVE${uniq()}`).toUpperCase().slice(0, 24),
      type: opts.type ?? 'FIXED',
      value: opts.value ?? 10,
      minOrder: opts.minOrder ?? 0,
      maxDiscount: opts.maxDiscount ?? null,
      usageLimit: opts.usageLimit ?? null,
      perUserLimit: opts.perUserLimit ?? 1,
      isActive: true,
    },
  });
}

export async function createDeposit(
  db: PrismaClient,
  userId: string,
  opts: { amount?: number; trxId?: string; status?: 'PENDING' | 'APPROVED' | 'REJECTED' } = {},
) {
  return db.deposit.create({
    data: {
      userId,
      method: 'BKASH',
      amount: opts.amount ?? 500,
      trxId: (opts.trxId ?? `TRX${uniq().toUpperCase()}`).toUpperCase().slice(0, 30),
      senderNo: '01712345678',
      status: opts.status ?? 'PENDING',
    },
  });
}

/**
 * ★ সরাসরি একটি COMPLETED অর্ডার — রিফান্ড টেস্টের শুরুর অবস্থা।
 *   ⚠️ এখানে ব্যালেন্স কাটা হয় না; রিফান্ড টেস্ট কেবল **ফেরত**
 *   পথটি মাপে, অর্ডার-পথ নয় (সেটির নিজের টেস্ট আছে)।
 */
export async function createCompletedOrder(
  db: PrismaClient,
  opts: { userId: string; variantId: number; price?: number; refundedAmount?: number },
) {
  const price = opts.price ?? 100;
  return db.order.create({
    data: {
      userId: opts.userId,
      variantId: opts.variantId,
      playerUid: '123456789',
      subtotal: price,
      discount: 0,
      price,
      productName: 'Test Product',
      variantName: 'Test Variant',
      status: 'COMPLETED',
      refundedAmount: opts.refundedAmount ?? 0,
      completedAt: new Date(),
    },
  });
}

/** ★ খতিয়ানের যোগফল — invariant যাচাইয়ের একক উৎস */
export async function ledgerSum(db: PrismaClient, userId: string): Promise<number> {
  const agg = await db.ledgerEntry.aggregate({
    where: { userId },
    _sum: { amount: true },
  });
  return Number(agg._sum.amount ?? 0);
}

export async function balanceOf(db: PrismaClient, userId: string): Promise<number> {
  const u = await db.user.findUnique({ where: { id: userId }, select: { balance: true } });
  return Number(u!.balance);
}
