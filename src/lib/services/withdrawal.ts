import { prisma } from '../prisma';
import { getSettings } from '../settings';
import { creditWallet, debitWallet } from './wallet';
import { round2 } from '../money';
import { ApiError } from '../guard';
import { cleanText } from '../sanitize';
import { dhakaDayStart } from '../date';
import type { Prisma } from '@prisma/client';

/**
 * ═══════════════════════════════════════════════════════════
 * ★★★ Group I (৫) — ওয়ালেট থেকে টাকা তোলা
 *
 *   ⚠️⚠️ এতদিন টাকা কেবল **ঢুকত** — বেরোনোর একমাত্র পথ ছিল রিফান্ড।
 *   এটিই প্রথম পথ যেখানে গ্রাহকের নির্দেশে টাকা বাইরে যায়।
 *
 *   ── কেন প্রতিটি নিয়ম আছে ──
 *
 *   ⚠️ **ডিফল্টে বন্ধ।** `withdrawal_enabled` না থাকলে বা `0` হলে
 *   অনুরোধই নেওয়া হয় না। সক্ষমতা আগে, টাকা পরে।
 *
 *   ⚠️ **কাটা হয় অনুরোধের সময়**, অনুমোদনের সময় নয়। অনুমোদনে কাটলে
 *   একই ব্যালেন্সের উপর দুটি অনুরোধ একসাথে ঝুলত, আর দুটোই অনুমোদন
 *   করলে ব্যালেন্স ঋণাত্মক হয়ে যেত।
 *
 *   ⚠️ **প্রত্যাখ্যানে নতুন সারি**, পুরনোটি সম্পাদনা নয়
 *   (`WITHDRAWAL_REVERSAL`)। খতিয়ান append-only — CLAUDE.md §2.1(৫)।
 *
 *   ⚠️ **ইউজার রো `FOR UPDATE` লক** সব যাচাইয়ের **আগে**, আর
 *   সিদ্ধান্তের প্রতিটি মান ঐ লক করা রো থেকেই আসে (§2.1(৩))।
 *   এখানে variant/coupon নেই, তাই লক-ক্রম (variant → coupon → user)
 *   অক্ষুণ্ণ থাকে — user-ই একমাত্র লক।
 * ═══════════════════════════════════════════════════════════
 */

export const WITHDRAWAL_KEYS = {
  enabled: 'withdrawal_enabled',
  min: 'withdrawal_min',
  dailyCap: 'withdrawal_daily_cap',
  holdHours: 'withdrawal_hold_hours',
  methods: 'withdrawal_methods',
} as const;

export type WithdrawalConfig = {
  enabled: boolean;
  min: number;
  dailyCap: number;
  holdHours: number;
  methods: string[];
};

const num = (v: string | undefined, dflt: number) => {
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 ? n : dflt;
};

export async function getWithdrawalConfig(): Promise<WithdrawalConfig> {
  const s = await getSettings();
  return {
    // ★★★ ডিফল্ট **বন্ধ** — মালিক নিজে চালু না করলে টাকা বেরোবে না
    enabled: s[WITHDRAWAL_KEYS.enabled] === '1' || s[WITHDRAWAL_KEYS.enabled] === 'true',
    min: num(s[WITHDRAWAL_KEYS.min], 500),
    dailyCap: num(s[WITHDRAWAL_KEYS.dailyCap], 25_000),
    // ★ গেটওয়ে-ডিপোজিটের টাকা কত ঘণ্টা তোলা যাবে না
    holdHours: num(s[WITHDRAWAL_KEYS.holdHours], 72),
    methods: (s[WITHDRAWAL_KEYS.methods] || 'BKASH,NAGAD,ROCKET')
      .split(',').map((m) => m.trim().toUpperCase()).filter(Boolean),
  };
}

/** ★ FIN-01 — রেফারেল বোনাস কত ঘণ্টা তোলা যাবে না (মালিকের সিদ্ধান্ত: স্থির ৭২) */
export const REFERRAL_HOLD_HOURS = 72;

/**
 * ★★★ তোলার যোগ্য অঙ্ক — ব্যালেন্স নয়।
 *
 *   ⚠️ কোন আক্রমণ এটি ঠেকায়: গেটওয়ে দিয়ে টাকা ঢুকিয়ে সাথে সাথেই
 *   তুলে নেওয়া = অর্থ পাচার (এবং চার্জব্যাক-প্রতারণা — গেটওয়ে পরে
 *   টাকা ফেরত নিয়ে যায়, ততক্ষণে আমাদের টাকা বেরিয়ে গেছে)।
 *   তাই সাম্প্রতিক `DEPOSIT` ও `REFUND` ক্রেডিট N ঘণ্টা আটকে থাকে।
 *
 *   ⚠️ হিসাবটি ইচ্ছাকৃতভাবে **রক্ষণশীল**: সাম্প্রতিক ক্রেডিটের পুরো
 *   যোগফল বাদ যায়, সেই টাকা খরচ হয়ে গেলেও। অর্থাৎ ১০০০ ঢুকিয়ে ৯০০
 *   খরচ করলে ব্যালেন্স ১০০, কিন্তু তোলার যোগ্য ০। এটি ভুল দিকে ভুল
 *   নয় — টাকা বেরোনোর পথে বেশি সতর্ক থাকাই সঠিক পক্ষপাত। নিখুঁত
 *   FIFO হিসাব করতে হলে প্রতিটি টাকার উৎস ট্র্যাক করতে হতো।
 */
export async function withdrawableAmount(
  tx: Prisma.TransactionClient,
  userId: string,
  balance: Prisma.Decimal | number,
  holdHours: number,
): Promise<number> {
  /**
   * ★★★ `holdHours = 0` মানে **hold নেই** — সেটিই অ্যাডমিনের সেটিংয়ের
   *   সরল অর্থ, আর কোডকেও ঠিক তাই বলতে হবে।
   *
   *   ⚠️ আগে ০ দিলেও গণনা চলত: `since = এখন`, আর শর্তটি `gte` —
   *   অর্থাৎ **ঠিক এই মুহূর্তে বা তার পরে** তৈরি হওয়া ক্রেডিট hold-এ
   *   পড়ত। `createdAt` ডাটাবেসের ঘড়ি থেকে আসে, `Date.now()` Node এর
   *   ঘড়ি থেকে; দুটোর মধ্যে সামান্য ব্যবধান থাকলেই (সদ্য চালু হওয়া
   *   ডকার কনটেইনারে যা স্বাভাবিক) সদ্য করা জমা "সাম্প্রতিক" গণ্য হয়ে
   *   পুরো ব্যালেন্স আটকে দিত। ২০২৬-০৮-১৪ তে ঠিক এই কারণেই
   *   `withdrawal.test.ts` এর ৪টি টেস্ট ("সাম্প্রতিক জমা **0 ঘণ্টা**
   *   পর তোলা যাবে") এক রানে ব্যর্থ, পরের রানে সবুজ হতো।
   *
   *   ⚠️ এটি গার্ডটিকে **শুধু তখনই** শিথিল করে যখন মালিক নিজে
   *   `withdrawal_hold_hours = 0` দিয়েছেন। ডিফল্ট ৭২ ঘণ্টা অপরিবর্তিত।
   *   ⚠️ ০ কেবল ডিপোজিট/ফেরতের hold তোলে — রেফারেল-hold ও অ্যাডমিন-সমন্বয়ের
   *   বাধা (FIN-01, নিচে) তখনও বহাল।
   */
  let heldAmt = 0;
  if (holdHours > 0) {
    const since = new Date(Date.now() - holdHours * 3600_000);
    const held = await tx.ledgerEntry.aggregate({
      where: {
        userId,
        type: { in: ['DEPOSIT', 'REFUND'] },
        createdAt: { gte: since },
      },
      _sum: { amount: true },
    });
    heldAmt += Number(held._sum.amount ?? 0);
  }

  /**
   * ★★★ FIN-01 (মালিকের সিদ্ধান্ত, ২০২৬-০৯-২৭) — রেফারেল বোনাস **৭২ ঘণ্টা** আটকে।
   *
   *   ⚠️ আগে `REFERRAL_BONUS` কোনো hold-এই পড়ত না: ভুয়া অ্যাকাউন্ট খুলে
   *   নিজের কোডে রেফার → বোনাস → সাথে সাথে তোলা। ঘণ্টাটি **স্থির**, ডিপোজিট-
   *   hold সেটিং থেকে আলাদা — `withdrawal_hold_hours = 0` দিলেও বোনাস ৭২
   *   ঘণ্টা আটকে থাকে, কারণ সিদ্ধান্তটি বোনাসের জন্য আলাদাভাবে নেওয়া।
   */
  //   ⚠️ `gt`, `gte` নয়: ঠিক ৭২ ঘণ্টা পূর্ণ হওয়ার মুহূর্তেই বোনাস মুক্ত। সময়ের উৎস
  //   সার্ভার (`Date.now()`) আর খতিয়ানের `createdAt` (ডাটাবেসের `now()`) — ক্লায়েন্টের
  //   কোনো সময় এখানে ঢোকে না। প্রতিটি বোনাস-সারির নিজের `createdAt`, তাই একাধিক
  //   বোনাসের hold আলাদা আলাদা শেষ হয়।
  const refSince = new Date(Date.now() - REFERRAL_HOLD_HOURS * 3600_000);
  const referral = await tx.ledgerEntry.aggregate({
    where: { userId, type: 'REFERRAL_BONUS', createdAt: { gt: refSince } },
    _sum: { amount: true },
  });
  heldAmt += Number(referral._sum.amount ?? 0);

  /**
   * ★★★ FIN-01 — অ্যাডমিনের ধনাত্মক সমন্বয় **কখনো নিজে থেকে** তোলার যোগ্য নয়।
   *
   *   ⚠️ এটি জমা দেওয়া টাকা নয় — অ্যাডমিনের হাতে তৈরি ব্যালেন্স। কেনাকাটায়
   *   খরচ করা যায়, কিন্তু নগদে বের করা যায় না (সময়সীমা নেই, স্থায়ী)। বিশেষ
   *   প্রয়োজনে প্রত্যাহার-অনুমোদনের বিদ্যমান অ্যাডমিন-নিয়ন্ত্রণই পথ।
   *
   *   ⚠️ **নিট** যোগফল (ক্রেডিট − ডেবিট), শূন্যের নিচে নয়: ভুল ক্রেডিট পরে
   *   ডেবিটে শুধরে দিলে গ্রাহকের নিজের জমা টাকা স্থায়ীভাবে আটকে যাওয়া ঠিক
   *   নয়। আর সর্বকালের যোগফল বলে টাকাটি অর্ডারে খরচ → রিফান্ড হয়ে এলেও
   *   (REFUND, ৭২ ঘণ্টা পর মুক্ত) এই অংশটুকু আটকেই থাকে।
   */
  const adjust = await tx.ledgerEntry.aggregate({
    where: { userId, type: 'ADMIN_ADJUST' },
    _sum: { amount: true },
  });
  heldAmt += Math.max(0, Number(adjust._sum.amount ?? 0));

  return Math.max(0, round2(Number(balance) - heldAmt));
}

/** ★ আজকের অনুমোদিত + ঝুলন্ত অঙ্ক — দৈনিক সীমার জন্য */
async function todaysTotal(tx: Prisma.TransactionClient, userId: string): Promise<number> {
  // ★ দৈনিক সীমা ঢাকার মধ্যরাতে নতুন হয় (মালিকের সিদ্ধান্ত, ২০২৬-০৯-১৭)। আগে
  //   `setHours` সার্ভারের ঘড়িতে — Vercel-এ (UTC) দিন বদলাত ঢাকার সকাল ৬টায়।
  const dayStart = dhakaDayStart();

  const agg = await tx.withdrawal.aggregate({
    where: {
      userId,
      createdAt: { gte: dayStart },
      // ⚠️ প্রত্যাখ্যাত অনুরোধ গোনা হয় না — টাকা ফেরত গেছে
      status: { in: ['PENDING', 'HELD', 'APPROVED'] },
    },
    _sum: { amount: true },
  });
  return Number(agg._sum.amount ?? 0);
}

export type RequestInput = {
  userId: string;
  amount: number;
  method: string;
  accountNumber: string;
  /** ★ ঝুঁকি বেশি হলে সরাসরি HELD — অ্যাডমিন না দেখা পর্যন্ত সারিতে নয় */
  elevatedRisk?: boolean;
  riskNote?: string | null;
};

/**
 * ★★★ প্রত্যাহারের অনুরোধ — ব্যালেন্স **এখানেই** কাটা হয়।
 *
 *   পুরোটা একটি ট্রানজেকশনে, ইউজার রো লক করে। ফলে দুটি সমান্তরাল
 *   অনুরোধ ক্রমিক হয়ে যায় — দ্বিতীয়টি প্রথমটির ফল দেখে, তাই
 *   "একটিই ঝুলন্ত" ও ব্যালেন্স-যাচাই দুটোই নির্ভরযোগ্য।
 */
/**
 * ★★★ ডাটাবেস-নিরপেক্ষ যাচাই — চালু আছে কি না, অঙ্ক, মাধ্যম, নাম্বার।
 *
 *   আলাদা করা হলো কারণ রুটটি এগুলো **OTP খরচের আগে** ডাকে। আগে OTP
 *   আগে খরচ হতো, তারপর এই যাচাই — অর্থাৎ ভুল অঙ্ক বা নাম্বার দিলে কোডটি
 *   নষ্ট হয়ে যেত এবং গ্রাহককে নতুন কোড চাইতে হতো (যা রেট-লিমিটে বাঁধা)।
 *   (চূড়ান্ত অডিট ২০২৬-০৯-১৭, মালিকের অনুমোদনে।)
 *
 *   ⚠️ লক-নির্ভর যাচাই (ব্যালেন্স, দৈনিক সীমা, ঝুলন্ত অনুরোধ) এখানে
 *   **নেই** — সেগুলো লক করা রো দেখেই হতে হবে (CLAUDE.md §2.1-৩), তাই
 *   `requestWithdrawal` এর ট্রানজেকশনেই থাকে। একই নিয়ম দুই জায়গায়
 *   নয়: `requestWithdrawal` নিজেও এটিই ডাকে।
 */
export function assertWithdrawalInputs(
  cfg: WithdrawalConfig,
  input: { amount: number; method: string; accountNumber: string },
): { amount: number; method: string; accountNumber: string } {
  if (!cfg.enabled) throw new ApiError('টাকা তোলার সুবিধা এখন বন্ধ আছে', 403);

  const amount = round2(Number(input.amount));
  if (!Number.isFinite(amount) || amount <= 0) throw new ApiError('সঠিক পরিমাণ দিন', 400);
  if (amount < cfg.min) throw new ApiError(`সর্বনিম্ন ৳${cfg.min} তোলা যাবে`, 400);

  const method = input.method.trim().toUpperCase();
  if (!cfg.methods.includes(method)) throw new ApiError('এই মাধ্যমে টাকা পাঠানো হয় না', 400);

  const accountNumber = cleanText(input.accountNumber, 20);
  if (!/^01[3-9]\d{8}$/.test(accountNumber)) throw new ApiError('সঠিক মোবাইল নাম্বার দিন', 400);

  return { amount, method, accountNumber };
}

export async function requestWithdrawal(input: RequestInput) {
  const cfg = await getWithdrawalConfig();
  const { amount, method, accountNumber } = assertWithdrawalInputs(cfg, input);

  return prisma.$transaction(async (tx) => {
    // ★★★ ১. ইউজার রো লক — সব যাচাইয়ের আগে
    const locked = await tx.$queryRaw<{ id: string; balance: Prisma.Decimal; isBanned: boolean }[]>`
      SELECT "id", "balance", "isBanned" FROM "User" WHERE "id" = ${input.userId} FOR UPDATE
    `;
    const me = locked[0];
    if (!me) throw new ApiError('ব্যবহারকারী পাওয়া যায়নি', 404);
    if (me.isBanned) throw new ApiError('অ্যাকাউন্ট স্থগিত', 403);

    // ★ ২. একটিই ঝুলন্ত অনুরোধ
    const pending = await tx.withdrawal.count({
      where: { userId: input.userId, status: { in: ['PENDING', 'HELD'] } },
    });
    if (pending > 0) {
      throw new ApiError('আপনার একটি অনুরোধ এখনো প্রক্রিয়াধীন — সেটি শেষ হলে আবার চেষ্টা করুন', 409);
    }

    // ★ ৩. দৈনিক সীমা
    const today = await todaysTotal(tx, input.userId);
    if (round2(today + amount) > cfg.dailyCap) {
      throw new ApiError(`দৈনিক সর্বোচ্চ ৳${cfg.dailyCap} — আজ আর তোলা যাবে না`, 400);
    }

    // ★ ৪. তোলার যোগ্য অঙ্ক (লক করা রো-র ব্যালেন্স থেকে)
    const usable = await withdrawableAmount(tx, input.userId, me.balance, cfg.holdHours);
    if (amount > usable) {
      throw new ApiError(
        // ★ FIN-01 — অ্যাডমিনের দেওয়া অংশ কখনো মুক্ত হয় না, তাই শুধু "অপেক্ষা করুন" বলা ভুল হতো
        usable <= 0
          ? `এখন তোলার যোগ্য টাকা নেই — সাম্প্রতিক জমা/ফেরত ${cfg.holdHours} ঘণ্টা ও রেফারেল বোনাস ${REFERRAL_HOLD_HOURS} ঘণ্টা পর তোলা যায়; অ্যাডমিনের দেওয়া ব্যালেন্স তোলা যায় না`
          : `এখন সর্বোচ্চ ৳${usable} তোলা যাবে`,
        400,
      );
    }

    // ★ ৫. অনুরোধের সারি — কাটার **আগে**, যাতে refId পাওয়া যায়
    const w = await tx.withdrawal.create({
      data: {
        userId: input.userId,
        amount,
        method,
        accountNumber,
        status: input.elevatedRisk ? 'HELD' : 'PENDING',
        riskLevel: input.elevatedRisk ? 'ELEVATED' : 'NORMAL',
        riskNote: input.riskNote ?? null,
        heldAt: input.elevatedRisk ? new Date() : null,
      },
      select: { id: true, amount: true, status: true, createdAt: true },
    });

    // ★★★ ৬. এখনই কাটা — খতিয়ানসহ, একই ট্রানজেকশনে
    await debitWallet({
      tx,
      userId: input.userId,
      amount,
      type: 'WITHDRAWAL',
      refId: w.id,
      note: `প্রত্যাহারের অনুরোধ — ${method} ${accountNumber}`,
    });

    return w;
  });
}

/**
 * ★★★ অনুমোদন — টাকা **আগেই** কাটা, তাই এখানে কোনো ব্যালেন্স নড়ে না।
 *
 *   ⚠️ অবস্থা `PENDING`/`HELD` থেকে বদলাচ্ছে কি না তা লক করা সারি
 *   দেখে যাচাই হয় — নাহলে দুই অ্যাডমিন একসাথে অনুমোদন করলে দুবার
 *   পরিশোধ হয়ে যেত (ডাটাবেস সেটি কখনো দেখত না)।
 *
 *   ⚠️ `payoutRef` বাধ্যতামূলক — হাতে পাঠানো টাকার প্রমাণ ছাড়া
 *   "অনুমোদিত" লেখা মানে পরে কেউ মিলিয়ে দেখতে পারবে না।
 */
export async function approveWithdrawal(opts: {
  id: string;
  payoutRef: string;
  adminId: string;
  adminName: string;
  note?: string;
}) {
  const payoutRef = cleanText(opts.payoutRef, 60);
  if (!payoutRef) throw new ApiError('পরিশোধের লেনদেন নম্বর দিন', 400);

  return prisma.$transaction(async (tx) => {
    const rows = await tx.$queryRaw<{ id: string; status: string }[]>`
      SELECT "id", "status"::text FROM "Withdrawal" WHERE "id" = ${opts.id} FOR UPDATE
    `;
    const w = rows[0];
    if (!w) throw new ApiError('অনুরোধ পাওয়া যায়নি', 404);
    if (w.status !== 'PENDING' && w.status !== 'HELD') {
      throw new ApiError('এই অনুরোধ ইতিমধ্যে নিষ্পত্তি হয়েছে', 409);
    }

    await tx.withdrawal.update({
      where: { id: w.id },
      data: {
        status: 'APPROVED',
        payoutRef,
        adminNote: opts.note ? cleanText(opts.note, 500) : null,
        processedById: opts.adminId,
        processedByName: opts.adminName,
        processedAt: new Date(),
      },
    });

    // ⚠️ ব্যালেন্স ইচ্ছাকৃতভাবে **স্পর্শ করা হয় না** — অনুরোধের সময়ই
    //    কাটা হয়ে গেছে। এখানে আবার কাটলে দ্বিগুণ কাটা হতো।
    return { ok: true as const };
  });
}

/**
 * ★★★ প্রত্যাখ্যান — টাকা খতিয়ানের মাধ্যমে ফেরত।
 *
 *   ⚠️ মূল `WITHDRAWAL` সারিটি **অক্ষত** থাকে; একটি নতুন
 *   `WITHDRAWAL_REVERSAL` সারি লেখা হয়। খতিয়ান append-only, তাই
 *   "কত টাকা কখন কেন নড়ল" সবসময় পুনর্গঠন করা যায়।
 */
export async function rejectWithdrawal(opts: {
  id: string;
  reason: string;
  adminId: string;
  adminName: string;
}) {
  const reason = cleanText(opts.reason, 500);
  if (!reason) throw new ApiError('প্রত্যাখ্যানের কারণ লিখুন', 400);

  return prisma.$transaction(async (tx) => {
    const rows = await tx.$queryRaw<{ id: string; status: string; userId: string; amount: Prisma.Decimal }[]>`
      SELECT "id", "status"::text, "userId", "amount" FROM "Withdrawal" WHERE "id" = ${opts.id} FOR UPDATE
    `;
    const w = rows[0];
    if (!w) throw new ApiError('অনুরোধ পাওয়া যায়নি', 404);
    if (w.status !== 'PENDING' && w.status !== 'HELD') {
      throw new ApiError('এই অনুরোধ ইতিমধ্যে নিষ্পত্তি হয়েছে', 409);
    }

    await tx.withdrawal.update({
      where: { id: w.id },
      data: {
        status: 'REJECTED',
        adminNote: reason,
        processedById: opts.adminId,
        processedByName: opts.adminName,
        processedAt: new Date(),
      },
    });

    await creditWallet({
      tx,
      userId: w.userId,
      amount: w.amount,
      type: 'WITHDRAWAL_REVERSAL',
      refId: w.id,
      note: `প্রত্যাহার প্রত্যাখ্যাত — ${reason}`,
    });

    return { ok: true as const };
  });
}

export async function listUserWithdrawals(userId: string) {
  return prisma.withdrawal.findMany({
    where: { userId },
    orderBy: { createdAt: 'desc' },
    take: 50,
    select: {
      id: true, amount: true, method: true, accountNumber: true, status: true,
      adminNote: true, payoutRef: true, createdAt: true, processedAt: true,
    },
  });
}

export async function listAdminWithdrawals(status?: 'PENDING' | 'HELD' | 'APPROVED' | 'REJECTED') {
  return prisma.withdrawal.findMany({
    where: status ? { status } : {},
    orderBy: [{ status: 'asc' }, { createdAt: 'asc' }],
    take: 100,
    select: {
      id: true, amount: true, method: true, accountNumber: true, status: true,
      riskLevel: true, riskNote: true, adminNote: true, payoutRef: true,
      createdAt: true, processedAt: true, processedByName: true,
      user: { select: { id: true, name: true, email: true, balance: true } },
    },
  });
}
