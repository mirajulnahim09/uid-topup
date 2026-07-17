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
  name: z.string().trim().min(2, 'নাম কমপক্ষে ২ অক্ষর').max(60),
  email: z.string().trim().toLowerCase().email('সঠিক ইমেইল দিন').max(120),
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
  amount: z.coerce.number().positive('সঠিক পরিমাণ দিন').max(1_000_000),
  trxId: z
    .string().trim().toUpperCase()
    .min(6, 'সঠিক ট্রানজেকশন আইডি দিন').max(30)
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

export const couponCheckSchema = z.object({
  code: z.string().trim().toUpperCase().min(2).max(24),
  variantId: z.coerce.number().int().positive(),
});

export const adminDepositActionSchema = z.object({
  depositId: z.string().min(1).max(40),
  action: z.enum(['APPROVE', 'REJECT']),
  adminNote: z.string().max(300).optional(),
});

export const adminOrderActionSchema = z.object({
  orderId: z.string().min(1).max(40),
  action: z.enum(['PROCESSING', 'COMPLETE', 'FAIL']),
  adminNote: z.string().max(300).optional(),
  internalNote: z.string().max(500).optional(),
  playerName: z.string().max(80).optional(),
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
