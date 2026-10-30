import type { DepositRejectReason, OrderFailReason } from '@prisma/client';

/**
 * ═══════════════════════════════════════════════════════════
 * ★ বাতিলের কারণ → গ্রাহকের জন্য সুনির্দিষ্ট, কাজের বার্তা
 *
 *   কেন এটা জরুরি (MANUAL_WORKFLOW.md A7):
 *   পেমেন্ট বাতিল হওয়া পুরো সিস্টেমের সবচেয়ে ঝুঁকিপূর্ণ মুহূর্ত —
 *   গ্রাহক বিশ্বাস করে সে টাকা পাঠিয়েছে। শুধু "বাতিল" লিখলে সে
 *   ধরে নেয় প্রতারিত হয়েছে, আর সরাসরি ফেসবুকে অভিযোগ করে।
 *
 *   প্রতিটি বার্তায় তিনটি জিনিস থাকতে হবে:
 *     ১. ঠিক কী হয়েছে (অস্পষ্ট নয়)
 *     ২. এখন সে কী করবে (প্রতিকার)
 *     ৩. কোথায় যোগাযোগ করবে
 *
 *   ★ কেন অ্যাডমিনের হাতে লেখার উপর ছাড়া হলো না:
 *     ভালো বার্তা লিখতে সময় লাগে। ব্যস্ত অ্যাডমিন প্রতিবার লিখবে না —
 *     তাই ভালো বার্তা লেখাই সবচেয়ে *সহজ* পথ হতে হবে।
 * ═══════════════════════════════════════════════════════════
 */

type ReasonCopy = {
  /** অ্যাডমিন যে লেবেল দেখবে (ছোট) */
  adminLabel: string;
  /** গ্রাহককে দেখানো ব্যাখ্যা + প্রতিকার */
  customerMessage: string;
  /** এই কারণে নোট বাধ্যতামূলক? */
  requiresNote?: boolean;
};

export const DEPOSIT_REJECT_COPY: Record<DepositRejectReason, ReasonCopy> = {
  TRX_NOT_FOUND: {
    adminLabel: 'TrxID পাওয়া যায়নি',
    customerMessage:
      'আপনার দেওয়া ট্রানজেকশন আইডিটি আমাদের bKash/Nagad স্টেটমেন্টে খুঁজে পাওয়া যায়নি। ' +
      'আইডিটি আবার মিলিয়ে দেখুন — টাকা পাঠানোর SMS এ যেভাবে আছে ঠিক সেভাবে দিন। ' +
      'টাকা কেটে থাকলে পেমেন্টের স্ক্রিনশট নিয়ে সাপোর্টে যোগাযোগ করুন, আমরা আবার দেখব।',
  },
  AMOUNT_MISMATCH: {
    adminLabel: 'টাকার অঙ্ক মেলেনি',
    customerMessage:
      'পাঠানো টাকার পরিমাণ রিকোয়েস্টের সাথে মিলছে না। সঠিক অঙ্কসহ নতুন রিকোয়েস্ট পাঠান। ' +
      'যদি আপনি ঠিক পরিমাণই পাঠিয়ে থাকেন, স্ক্রিনশট নিয়ে সাপোর্টে জানান — আমরা মিলিয়ে দেখব।',
    requiresNote: true,
  },
  DUPLICATE_TRX: {
    adminLabel: 'একই TrxID আগে ব্যবহৃত',
    customerMessage:
      'এই ট্রানজেকশন আইডি দিয়ে আগেই একটি রিকোয়েস্ট প্রসেস করা হয়েছে। ' +
      'একই পেমেন্ট দুইবার জমা দেওয়া যায় না। নতুন পেমেন্ট করে থাকলে সেই নতুন TrxID দিন।',
  },
  UNCLEAR_PROOF: {
    adminLabel: 'স্ক্রিনশট অস্পষ্ট',
    customerMessage:
      'পেমেন্টের প্রমাণ স্পষ্ট নয়। এমন একটি স্ক্রিনশট দিন যেখানে ট্রানজেকশন আইডি, ' +
      'টাকার পরিমাণ ও তারিখ — তিনটিই পড়া যায়। তারপর আবার রিকোয়েস্ট পাঠান।',
  },
  WRONG_ACCOUNT: {
    adminLabel: 'ভুল নাম্বারে পাঠানো',
    customerMessage:
      'টাকা আমাদের নির্ধারিত নাম্বারে আসেনি। ওয়েবসাইটে দেখানো নাম্বারেই ' +
      'Send Money করুন। ভুল নাম্বারে পাঠানো টাকা আমরা ফেরত দিতে পারি না — ' +
      'যেখানে পাঠিয়েছেন সেখানেই যোগাযোগ করতে হবে।',
  },
  OTHER: {
    adminLabel: 'অন্য কারণ',
    customerMessage: '', // অ্যাডমিনের নোটই মূল বার্তা
    requiresNote: true,
  },
};

export const ORDER_FAIL_COPY: Record<OrderFailReason, ReasonCopy> = {
  INVALID_UID: {
    adminLabel: 'UID ভুল / পাওয়া যায়নি',
    customerMessage:
      'দেওয়া আইডিটি গেমে খুঁজে পাওয়া যায়নি, তাই ডেলিভারি করা যায়নি। ' +
      'পুরো টাকা আপনার ওয়ালেটে ফেরত দেওয়া হয়েছে। ' +
      'গেমের প্রোফাইল থেকে আইডিটি আবার কপি করে নতুন অর্ডার করুন।',
  },
  OUT_OF_STOCK: {
    adminLabel: 'স্টক শেষ',
    customerMessage:
      'দুঃখিত, এই প্যাকেজটি সাময়িকভাবে শেষ হয়ে গেছে। ' +
      'পুরো টাকা আপনার ওয়ালেটে ফেরত দেওয়া হয়েছে — অন্য প্যাকেজ বেছে নিতে পারেন।',
  },
  GAME_SERVER_ISSUE: {
    adminLabel: 'গেম সার্ভারের সমস্যা',
    customerMessage:
      'গেমের সার্ভারে সমস্যার কারণে এই মুহূর্তে টপ-আপ করা যাচ্ছে না। ' +
      'পুরো টাকা আপনার ওয়ালেটে ফেরত দেওয়া হয়েছে। কিছুক্ষণ পর আবার চেষ্টা করুন।',
  },
  PRICE_CHANGED: {
    adminLabel: 'দাম বদলে গেছে',
    customerMessage:
      'সরবরাহকারীর দাম পরিবর্তনের কারণে এই অর্ডারটি সম্পন্ন করা যায়নি। ' +
      'পুরো টাকা আপনার ওয়ালেটে ফেরত দেওয়া হয়েছে — বর্তমান দামে নতুন অর্ডার করতে পারেন।',
    requiresNote: true,
  },
  CUSTOMER_REQUEST: {
    adminLabel: 'গ্রাহকের অনুরোধে',
    customerMessage:
      'আপনার অনুরোধ অনুযায়ী অর্ডারটি বাতিল করা হয়েছে। ' +
      'পুরো টাকা আপনার ওয়ালেটে ফেরত দেওয়া হয়েছে।',
  },
  OTHER: {
    adminLabel: 'অন্য কারণ',
    customerMessage: '',
    requiresNote: true,
  },
};

/**
 * ★ চূড়ান্ত গ্রাহক-বার্তা তৈরি — কাঠামোবদ্ধ কারণ + অ্যাডমিনের নোট।
 *   কোনোটাই না থাকলে অন্তত একটি সৎ সাধারণ বার্তা ফেরত যায় —
 *   গ্রাহক কখনো খালি "বাতিল" দেখবে না।
 */
export function buildRejectionMessage(
  copy: ReasonCopy | undefined,
  adminNote: string | undefined | null,
  fallback: string
): string {
  const base = copy?.customerMessage?.trim() || '';
  const note = adminNote?.trim() || '';

  if (base && note) return `${base}\n\nঅতিরিক্ত তথ্য: ${note}`;
  if (base) return base;
  if (note) return note;
  return fallback;
}

/** UI তে ড্রপডাউন বানানোর জন্য */
export function depositRejectOptions() {
  return (Object.keys(DEPOSIT_REJECT_COPY) as DepositRejectReason[]).map((k) => ({
    value: k,
    label: DEPOSIT_REJECT_COPY[k].adminLabel,
    requiresNote: !!DEPOSIT_REJECT_COPY[k].requiresNote,
  }));
}

export function orderFailOptions() {
  return (Object.keys(ORDER_FAIL_COPY) as OrderFailReason[]).map((k) => ({
    value: k,
    label: ORDER_FAIL_COPY[k].adminLabel,
    requiresNote: !!ORDER_FAIL_COPY[k].requiresNote,
  }));
}
