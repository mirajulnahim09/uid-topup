import { z } from 'zod';

// ★ দুর্বল পাসওয়ার্ড — সবচেয়ে বেশি ব্যবহৃত, ব্রুট-ফোর্সে প্রথমেই চেষ্টা হয়
const WEAK_PASSWORDS = new Set([
  '123456', 'password', '12345678', 'qwerty', '123456789', '12345',
  '1234', '111111', '1234567', 'dragon', '123123', 'abc123',
  'football', 'monkey', 'letmein', '696969', 'shadow', 'master',
  '666666', 'qwertyuiop', '123321', 'mustang', '1234567890',
  'password1', 'admin', 'admin123', 'welcome', 'login', 'passw0rd',
  'bangladesh', 'freefire', 'garena', 'topup',
]);

// ★ পাসওয়ার্ডের নিয়ম — রেজিস্টার ও পাসওয়ার্ড বদলানো দুই জায়গায়
export const passwordSchema = z
  .string()
  .min(8, 'পাসওয়ার্ড কমপক্ষে ৮ অক্ষর')
  .max(72, 'পাসওয়ার্ড অনেক বড়')
  .refine((p) => !WEAK_PASSWORDS.has(p.toLowerCase()),
    'এই পাসওয়ার্ডটি খুব সহজ — অন্য কিছু দিন')
  .refine((p) => /[a-zA-Z\u0980-\u09FF]/.test(p),
    'পাসওয়ার্ডে অন্তত একটি অক্ষর থাকতে হবে')
  .refine((p) => /[0-9]/.test(p),
    'পাসওয়ার্ডে অন্তত একটি সংখ্যা থাকতে হবে');

export const registerSchema = z.object({
  name: z.string().trim().min(2, 'নাম কমপক্ষে ২ অক্ষর').max(60, 'নাম অনেক বড়'),
  email: z.string().trim().toLowerCase().email('সঠিক ইমেইল দিন').max(120, 'ইমেইল অনেক বড়'),
  phone: z.string().trim().regex(/^01[3-9]\d{8}$/, 'সঠিক মোবাইল নাম্বার দিন (01712345678)'),
  password: passwordSchema,
  referralCode: z.string().trim().toUpperCase().max(16).optional().or(z.literal('')),
});

export const forgotSchema = z.object({
  email: z.string().trim().toLowerCase().email('সঠিক ইমেইল দিন').max(120),
});

export const resetSchema = z.object({
  token: z.string().min(10, 'অবৈধ লিংক').max(500),
  password: passwordSchema,
});

export const depositSchema = z.object({
  method: z.enum(['BKASH', 'NAGAD', 'ROCKET', 'UPAY']),
  amount: z.coerce.number().positive('সঠিক পরিমাণ দিন').max(1_000_000, 'পরিমাণ অনেক বড়'),
  trxId: z
    .string().trim().toUpperCase()
    .min(6, 'সঠিক ট্রানজেকশন আইডি দিন').max(30, 'ট্রানজেকশন আইডি অনেক বড়')
    .regex(/^[A-Z0-9]+$/, 'TrxID তে শুধু অক্ষর ও সংখ্যা থাকবে'),
  senderNo: z.string().trim().regex(/^01[3-9]\d{8}$/, 'যে নাম্বার থেকে পাঠিয়েছেন সেটি দিন'),
  screenshot: z.string().url().max(500).optional().or(z.literal('')),
});

export const orderSchema = z.object({
  variantId: z.coerce.number().int().positive(),
  playerUid: z
    .string().trim()
    .min(3, 'সঠিক UID দিন').max(80)
    // ★ শুধু ASCII অক্ষর, সংখ্যা ও নিরাপদ চিহ্ন — unicode লুকোচুরি নয়
    .regex(/^[a-zA-Z0-9._@+\-]+$/, 'UID তে অবৈধ অক্ষর আছে'),
  playerName: z.string().trim().max(80).optional().or(z.literal('')),
  couponCode: z.string().trim().toUpperCase().max(24).optional().or(z.literal('')),
});

/** ★ ডাইরেক্ট পে — অর্ডারের তথ্য + পেমেন্টের দাবি একসাথে */
export const directOrderSchema = orderSchema.extend({
  method: z.enum(['BKASH', 'NAGAD', 'ROCKET', 'UPAY']),
  amount: z.coerce.number().positive('সঠিক পরিমাণ দিন').max(1_000_000, 'পরিমাণ অনেক বড়'),
  trxId: z
    .string().trim().toUpperCase()
    .min(6, 'সঠিক ট্রানজেকশন আইডি দিন').max(30, 'ট্রানজেকশন আইডি অনেক বড়')
    .regex(/^[A-Z0-9]+$/, 'TrxID তে শুধু অক্ষর ও সংখ্যা থাকবে'),
  senderNo: z.string().trim().regex(/^01[3-9]\d{8}$/, 'যে নাম্বার থেকে পাঠিয়েছেন সেটি দিন'),
  screenshot: z.string().url().max(500).optional().or(z.literal('')),
});

/**
 * ★ লগইন ছাড়া অর্ডার ট্র্যাকিং।
 *   হয় গোপন টোকেন, নয়তো অর্ডার নাম্বার + ফোন/ইমেইল —
 *   শুধু অর্ডার নাম্বার কখনোই যথেষ্ট নয় (enumeration ঠেকাতে)।
 */
export const trackLookupSchema = z
  .object({
    token: z.string().trim().min(10).max(120).optional(),
    orderNo: z.coerce.number().int().positive().optional(),
    contact: z.string().trim().max(120).optional(),
  })
  .refine((d) => Boolean(d.token) || (Boolean(d.orderNo) && Boolean(d.contact?.trim())), {
    message: 'অর্ডার নাম্বার ও ফোন/ইমেইল দুটোই দিন',
  });

/** ★ ডেলিভারি পৌঁছেছে কিনা — গ্রাহকের নিশ্চিতকরণ */
export const deliveryConfirmSchema = z.object({
  orderId: z.string().min(1).max(40),
  arrived: z.boolean(),
});

/** ★ রিভিউ — শুধু নিশ্চিত হওয়া অর্ডারের বিপরীতে */
export const reviewSchema = z.object({
  orderId: z.string().min(1).max(40),
  rating: z.coerce.number().int().min(1, 'রেটিং দিন').max(5, 'রেটিং ১–৫ এর মধ্যে'),
  body: z.string().trim().max(500, 'মন্তব্য অনেক বড়').optional().or(z.literal('')),
  // ★ ঐচ্ছিক স্ক্রিনশট — গ্রাহক চাইলে দেবে, না চাইলে নয়
  photoUrl: z.string().url().max(500).optional().or(z.literal('')),
});

export const uidVerifySchema = z.object({
  productId: z.coerce.number().int().positive(),
  uid: z
    .string().trim()
    .min(3, 'সঠিক UID দিন').max(80, 'UID অনেক বড়')
    .regex(/^[a-zA-Z0-9._@+\-]+$/, 'UID তে অবৈধ অক্ষর আছে'),
});

export const couponCheckSchema = z.object({
  code: z.string().trim().toUpperCase().min(2, 'কুপন কোড দিন').max(24, 'কুপন কোড অনেক বড়'),
  variantId: z.coerce.number().int().positive(),
});

const DEPOSIT_REJECT_REASONS = [
  'TRX_NOT_FOUND', 'AMOUNT_MISMATCH', 'DUPLICATE_TRX',
  'UNCLEAR_PROOF', 'WRONG_ACCOUNT', 'OTHER',
] as const;

const ORDER_FAIL_REASONS = [
  'INVALID_UID', 'OUT_OF_STOCK', 'GAME_SERVER_ISSUE',
  'PRICE_CHANGED', 'CUSTOMER_REQUEST', 'OTHER',
] as const;

export const adminDepositActionSchema = z
  .object({
    depositId: z.string().min(1).max(40),
    action: z.enum(['APPROVE', 'REJECT']),
    adminNote: z.string().max(300).optional(),
    rejectReason: z.enum(DEPOSIT_REJECT_REASONS).optional(),
  })
  // ★ "অন্য কারণ" বাছলে নোট বাধ্যতামূলক — নাহলে গ্রাহক কিছুই বুঝবে না
  .refine((d) => d.action !== 'REJECT' || d.rejectReason !== 'OTHER' || !!d.adminNote?.trim(), {
    message: 'অন্য কারণ বাছলে নোট লিখতে হবে',
    path: ['adminNote'],
  });

export const adminOrderActionSchema = z
  .object({
    orderId: z.string().min(1).max(40),
    action: z.enum(['PROCESSING', 'COMPLETE', 'FAIL']),
    adminNote: z.string().max(300).optional(),
    internalNote: z.string().max(500).optional(),
    playerName: z.string().max(80).optional(),
    failReason: z.enum(ORDER_FAIL_REASONS).optional(),
    /** ★ অন্য অ্যাডমিনের সক্রিয় claim উপেক্ষা করে এগোনোর ইচ্ছাকৃত সম্মতি (3.7) */
    takeover: z.boolean().optional(),
  })
  .refine((d) => d.action !== 'FAIL' || d.failReason !== 'OTHER' || !!d.adminNote?.trim(), {
    message: 'অন্য কারণ বাছলে নোট লিখতে হবে',
    path: ['adminNote'],
  });

/** ★ অর্ডার claim / release (3.7) — টাকা নড়ে না, শুধু সমন্বয় */
export const adminOrderClaimSchema = z.object({
  orderId: z.string().min(1).max(40),
  action: z.enum(['CLAIM', 'RELEASE']),
  /** অন্যের সক্রিয় claim থাকলে ইচ্ছাকৃত টেক-ওভার */
  takeover: z.boolean().optional(),
});

/**
 * ★ বাল্ক অ্যাকশন (3.8)
 *
 *   ⚠️ enum-এ FAIL নেই এবং কখনো যোগ করা যাবে না — সেটি রিফান্ড
 *   চালায়। টাকা নড়ে এমন কিছু বাল্কে যায় না; এই enum-ই সেই
 *   সীমারেখার প্রথম পাহারা।
 */
export const adminOrderBulkSchema = z.object({
  orderIds: z.array(z.string().min(1).max(40)).min(1, 'অন্তত একটি অর্ডার বাছুন').max(20),
  action: z.enum(['CLAIM', 'PROCESSING', 'COMPLETE']),
});

/**
 * ★ আংশিক রিফান্ড (3.14)
 *
 *   ⚠️ কারণ **বাধ্যতামূলক** — টাকা ফেরতের প্রতিটি ঘটনার একটা
 *   ব্যাখ্যা থাকতেই হবে, নইলে পরে বিরোধে কেউ বলতে পারবে না কেন
 *   দেওয়া হয়েছিল। উপরের সীমা সার্ভারে অর্ডারের দাম থেকে যাচাই হয়;
 *   এখানে শুধু "ধনাত্মক ও যুক্তিসঙ্গত" পাহারা।
 */
export const adminPartialRefundSchema = z.object({
  orderId: z.string().min(1).max(40),
  amount: z.number().positive('অঙ্ক শূন্যের বেশি হতে হবে').max(1_000_000),
  reason: z.string().trim().min(3, 'কারণ লিখুন — কেন ফেরত দেওয়া হচ্ছে').max(300),
});

export const adminAdjustSchema = z.object({
  userId: z.string().min(1).max(40),
  amount: z.coerce.number()
    .refine((n) => n !== 0, 'পরিমাণ ০ হতে পারে না')
    .refine((n) => Math.abs(n) <= 500_000, 'পরিমাণ অনেক বড়'),
  note: z.string().trim().min(2, 'কারণ লিখুন').max(300),
});

export const adminCouponSchema = z.object({
  code: z.string().trim().toUpperCase()
    .min(3, 'কোড কমপক্ষে ৩ অক্ষর').max(24)
    .regex(/^[A-Z0-9_-]+$/, 'কোডে শুধু অক্ষর, সংখ্যা, - ও _ চলবে'),
  type: z.enum(['PERCENT', 'FIXED']),
  value: z.coerce.number().positive('মান ০ এর বেশি হতে হবে'),
  minOrder: z.coerce.number().min(0).default(0),
  maxDiscount: z.coerce.number().min(0).optional().nullable(),
  usageLimit: z.coerce.number().int().min(1).optional().nullable(),
  perUserLimit: z.coerce.number().int().min(1).max(100).default(1),
  expiresAt: z.string().optional().nullable(),
  isActive: z.boolean().default(true),
});

// ═════════ হোমপেজ বিপণন — Campaign (Option A, additive) ═════════
// ★ অ্যাডমিন-নিয়ন্ত্রিত হোমপেজ উপাদান। placement/kind সীমাবদ্ধ সেট
//   থেকে আসে যাতে ভুল মান ডেটাবেসে না ঢোকে। টেক্সট ফিল্ড রুটে
//   আলাদাভাবে cleanText/safeUrl দিয়ে সাফ হয় (XSS গার্ড)।
export const CAMPAIGN_PLACEMENTS = ['POPUP', 'HERO', 'SLIDER', 'NOTICE', 'STRIP', 'PROMO', 'FLOAT'] as const;
export const CAMPAIGN_KINDS = ['OFFER', 'EVENT', 'GIVEAWAY', 'TOURNAMENT', 'COUPON', 'NEW', 'INFO', 'WARNING', 'PROMO'] as const;

const isoOrNull = z.string().trim().max(40).optional().nullable()
  .refine((v) => !v || !Number.isNaN(Date.parse(v)), 'সঠিক তারিখ দিন');

export const campaignCreateSchema = z.object({
  placement: z.enum(CAMPAIGN_PLACEMENTS),
  kind: z.enum(CAMPAIGN_KINDS).default('PROMO'),
  title: z.string().trim().max(160).optional().nullable(),
  subtitle: z.string().trim().max(400).optional().nullable(),
  imageUrl: z.string().trim().max(600).optional().nullable(),
  ctaLabel: z.string().trim().max(60).optional().nullable(),
  ctaLink: z.string().trim().max(600).optional().nullable(),
  badge: z.string().trim().max(40).optional().nullable(),
  dismissible: z.boolean().default(true),
  frequency: z.enum(['once', 'session', 'always']).default('once'),
  isActive: z.boolean().default(true),
  startsAt: isoOrNull,
  endsAt: isoOrNull,
});

// ★ সম্পাদনা — সব ঐচ্ছিক, শুধু যা পাঠানো হয় তা-ই বদলায়
export const campaignPatchSchema = campaignCreateSchema.partial().extend({
  id: z.coerce.number().int().positive(),
  sortOrder: z.coerce.number().int().optional(),
});
