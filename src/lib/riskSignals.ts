import { prisma } from './prisma';

/**
 * ═══════════════════════════════════════════════════════════
 * ★ ঝুঁকির সংকেত — বিদ্যমান তথ্য থেকে হিসাব করা (3.5)
 *
 *   কেন (MANUAL_WORKFLOW.md B1 §4):
 *   "অ্যাডমিনকে *বলে দিতে* হবে কোনটা অস্বাভাবিক — খুঁজে বের
 *   করতে বলা যাবে না।" মানুষ প্যাটার্ন মিস করে; সিস্টেম করে না।
 *
 *   ★★★ ইচ্ছাকৃতভাবে কোনো CustomerRisk টেবিল নেই (অনুমোদিত সিদ্ধান্ত)।
 *
 *   কারণ: প্রতিটি সংকেতই ডিপোজিট/অর্ডারের ইতিহাস থেকে **সরাসরি
 *   বের করা যায়**। আলাদা টেবিল রাখলে —
 *     • তথ্য দুই জায়গায় থাকত (sync সমস্যা)
 *     • বাসি হয়ে যেত (ডিপোজিট বাতিল হলে ক্যাশ আপডেট না হলে ভুল দেখাত)
 *     • ঝুঁকির নিয়ম বদলালে পুরনো সব সারি পুনর্গণনা করতে হতো
 *   হিসাব করা সংকেত সবসময় বর্তমান সত্য বলে।
 *
 *   ⚠️ এগুলো **সিদ্ধান্ত নেয় না** — শুধু অ্যাডমিনের নজরে আনে।
 *      অনুমোদন/বাতিল সবসময় মানুষের হাতেই থাকে।
 *
 *   ★★★ Group H (১০ আগস্ট ২০২৬) — এখন এর দুটি **ভোক্তা** আছে:
 *   ১. অ্যাডমিন কিউ (আগে থেকেই) — লাইভ হিসাব, elevated হলে প্রতিটি
 *      সতর্কতা ticked না হওয়া পর্যন্ত approve বোতাম নিষ্ক্রিয়।
 *   ২. ডিপোজিট তৈরির পথ (নতুন) — elevated হলে দাবিটি **auto-hold**
 *      হয় ও অপারেটরকে টেলিগ্রামে জানানো হয়।
 *
 *   ⚠️ hold মানে **স্বয়ংক্রিয় ক্রেডিট বন্ধ**, গ্রাহককে আটকানো নয়।
 *      দাবিটি স্বাভাবিকভাবেই জমা হয়, গ্রাহক স্বাভাবিক বার্তাই দেখেন,
 *      আর অ্যাডমিন আগের মতোই অনুমোদন করতে পারেন। **কখনো auto-ban নয়**
 *      (RUN.md §GROUP H স্পষ্ট) — একটি ভুল সংকেতের শাস্তি যেন কখনো
 *      অ্যাকাউন্ট হারানো না হয়।
 * ═══════════════════════════════════════════════════════════
 */

export type RiskLevel = 'trusted' | 'normal' | 'elevated';

export type RiskSignal = {
  /** 'warn' = দেখে নিন, 'info' = প্রসঙ্গ, 'good' = আশ্বস্ত করার মতো */
  tone: 'warn' | 'info' | 'good';
  text: string;
};

export type RiskAssessment = {
  level: RiskLevel;
  signals: RiskSignal[];
  approvedCount: number;
  rejectedCount: number;
};

/** এতগুলো সফল ডিপোজিটের পর গ্রাহককে "পরিচিত" ধরা হয় */
const TRUSTED_APPROVED_MIN = 10;
/** এই সময়ে এতগুলোর বেশি দাবি = অস্বাভাবিক গতি */
const VELOCITY_WINDOW_MIN = 10;
const VELOCITY_MAX_CLAIMS = 3;
/** গ্রাহকের স্বাভাবিক অঙ্কের এত গুণ বেশি হলে চোখে পড়া উচিত */
const AMOUNT_ANOMALY_MULTIPLIER = 5;
/** নতুন অ্যাকাউন্ট — এত ঘন্টার কম বয়সে বড় দাবি সন্দেহজনক */
const NEW_ACCOUNT_HOURS = 24;

type DepositInput = {
  id: string;
  userId: string;
  amount: number;
  senderNo: string;
  createdAt: Date;
};

type UserInput = {
  phone: string;
  createdAt: Date;
};

/**
 * ★ একাধিক ডিপোজিটের জন্য একবারেই সব সংকেত হিসাব করে।
 *   প্রতি কার্ডে আলাদা query চালালে N+1 হতো — কিউতে ৫০টি
 *   কার্ড মানে ২০০+ query।
 */
export async function assessDeposits(
  deposits: DepositInput[],
  users: Map<string, UserInput>
): Promise<Map<string, RiskAssessment>> {
  const result = new Map<string, RiskAssessment>();
  if (deposits.length === 0) return result;

  const userIds = Array.from(new Set(deposits.map((d) => d.userId)));

  // ── এক ধাপে সব ইতিহাস ──
  const [statusCounts, recentClaims, priorApproved] = await Promise.all([
    // অনুমোদিত/বাতিলের সংখ্যা
    prisma.deposit.groupBy({
      by: ['userId', 'status'],
      where: { userId: { in: userIds } },
      _count: true,
    }),
    // গতি — সাম্প্রতিক সময়ে কতগুলো দাবি
    prisma.deposit.findMany({
      where: {
        userId: { in: userIds },
        createdAt: { gte: new Date(Date.now() - VELOCITY_WINDOW_MIN * 60_000) },
      },
      select: { userId: true, id: true },
    }),
    // স্বাভাবিক অঙ্ক বোঝার জন্য আগের অনুমোদিত ডিপোজিট
    prisma.deposit.findMany({
      where: { userId: { in: userIds }, status: 'APPROVED' },
      select: { userId: true, amount: true },
      orderBy: { createdAt: 'desc' },
      take: 200,
    }),
  ]);

  const approvedBy = new Map<string, number>();
  const rejectedBy = new Map<string, number>();
  for (const s of statusCounts) {
    if (s.status === 'APPROVED') approvedBy.set(s.userId, s._count);
    if (s.status === 'REJECTED') rejectedBy.set(s.userId, s._count);
  }

  const velocityBy = new Map<string, number>();
  for (const c of recentClaims) {
    velocityBy.set(c.userId, (velocityBy.get(c.userId) ?? 0) + 1);
  }

  // গ্রাহকপ্রতি সর্বোচ্চ পূর্ববর্তী অনুমোদিত অঙ্ক
  const maxPriorBy = new Map<string, number>();
  for (const d of priorApproved) {
    const amt = Number(d.amount);
    maxPriorBy.set(d.userId, Math.max(maxPriorBy.get(d.userId) ?? 0, amt));
  }

  for (const d of deposits) {
    const user = users.get(d.userId);
    const approvedCount = approvedBy.get(d.userId) ?? 0;
    const rejectedCount = rejectedBy.get(d.userId) ?? 0;
    const signals: RiskSignal[] = [];
    let elevated = false;

    // ── ১. প্রেরকের নাম্বার মেলে না ──
    if (user && d.senderNo.replace(/\D/g, '') !== user.phone.replace(/\D/g, '')) {
      signals.push({ tone: 'warn', text: 'প্রেরকের নাম্বার নিবন্ধিত নাম্বারের সাথে মিলছে না' });
      elevated = true;
    }

    // ── ২. প্রথমবার ──
    if (approvedCount === 0) {
      signals.push({ tone: 'info', text: 'এই গ্রাহকের প্রথম অনুমোদন — একটু ভালো করে দেখুন' });
      elevated = true;
    }

    // ── ৩. গতি — অল্প সময়ে অনেক দাবি ──
    const claims = velocityBy.get(d.userId) ?? 0;
    if (claims > VELOCITY_MAX_CLAIMS) {
      signals.push({
        tone: 'warn',
        text: `${VELOCITY_WINDOW_MIN} মিনিটে ${claims} টি রিকোয়েস্ট — অস্বাভাবিক গতি`,
      });
      elevated = true;
    }

    // ── ৪. অঙ্ক অস্বাভাবিক ──
    const maxPrior = maxPriorBy.get(d.userId) ?? 0;
    if (maxPrior > 0 && d.amount > maxPrior * AMOUNT_ANOMALY_MULTIPLIER) {
      signals.push({
        tone: 'warn',
        text: `এই গ্রাহকের আগের সর্বোচ্চ ছিল ৳${maxPrior.toFixed(0)} — এবার অনেক বেশি`,
      });
      elevated = true;
    }

    // ── ৫. নতুন অ্যাকাউন্টে বড় অঙ্কের **প্রথম** দাবি ──
    //    ⚠️ approvedCount === 0 শর্তটি জরুরি: আসল প্রতারণার ধরন হলো
    //    "নতুন অ্যাকাউন্ট, কোনো ইতিহাস নেই, বড় অঙ্ক"। যে গ্রাহকের
    //    ইতিমধ্যে সফল ডিপোজিট আছে, তার অ্যাকাউন্ট নতুন হলেও এটি
    //    সেই ধরন নয় — শর্ত ছাড়া বার্তাটি "প্রথম দাবি" বলত অথচ
    //    সেটি সত্য হতো না।
    if (user && approvedCount === 0) {
      const ageHours = (Date.now() - user.createdAt.getTime()) / 3_600_000;
      if (ageHours < NEW_ACCOUNT_HOURS && d.amount >= 5000) {
        signals.push({
          tone: 'warn',
          text: `অ্যাকাউন্ট ${Math.max(1, Math.round(ageHours))} ঘন্টার পুরনো — বড় অঙ্কের প্রথম দাবি`,
        });
        elevated = true;
      }
    }

    // ── ৬. আগে বাতিল হওয়ার ইতিহাস ──
    if (rejectedCount >= 3) {
      signals.push({
        tone: 'warn',
        text: `এই গ্রাহকের ${rejectedCount} টি রিকোয়েস্ট আগে বাতিল হয়েছে`,
      });
      elevated = true;
    }

    // ── ৭. পরিচিত ও নির্ভরযোগ্য ──
    //    ⚠️ কোনো সতর্কতা না থাকলেই কেবল
    const trusted = !elevated && approvedCount >= TRUSTED_APPROVED_MIN;
    if (trusted) {
      signals.push({ tone: 'good', text: `পরিচিত গ্রাহক — ${approvedCount} টি সফল ডিপোজিট` });
    }

    result.set(d.id, {
      level: elevated ? 'elevated' : trusted ? 'trusted' : 'normal',
      signals,
      approvedCount,
      rejectedCount,
    });
  }

  return result;
}

/**
 * ★ একটি ডিপোজিটের মূল্যায়ন — ব্যাচ ফাংশনটিই **পুনঃব্যবহার** করে।
 *
 *   কেন নতুন করে লিখলাম না: তাহলে ঝুঁকির নিয়ম দুই জায়গায় থাকত, আর
 *   একদিন অ্যাডমিন কিউ ও তৈরির-পথ দুটি ভিন্ন উত্তর দিত — অর্থাৎ
 *   অ্যাডমিন "elevated" দেখতেন অথচ hold হতো না, বা উল্টোটা।
 */
export async function assessOneDeposit(
  deposit: DepositInput,
  user: UserInput,
): Promise<RiskAssessment> {
  const map = await assessDeposits([deposit], new Map([[deposit.userId, user]]));
  return (
    map.get(deposit.id) ?? {
      level: 'normal',
      signals: [],
      approvedCount: 0,
      rejectedCount: 0,
    }
  );
}

/** ★ DB enum-এর রূপ (`DepositRisk`) — দুটি শব্দভাণ্ডার এক রাখতে */
export function toDbRisk(level: RiskLevel): 'TRUSTED' | 'NORMAL' | 'ELEVATED' {
  return level === 'elevated' ? 'ELEVATED' : level === 'trusted' ? 'TRUSTED' : 'NORMAL';
}

/** ★ সংকেতগুলোকে এক লাইনে — সংরক্ষণ ও বার্তা দুই কাজেই */
export function summarizeSignals(a: RiskAssessment): string {
  return a.signals
    .filter((s) => s.tone === 'warn')
    .map((s) => s.text)
    .join(' · ');
}

/**
 * ★★★ স্বয়ংক্রিয় ক্রেডিট অনুমোদিত কি না — **প্রতিটি** অটো-পথের
 *   এটি ডাকা বাধ্যতামূলক।
 *
 *   আজ কোনো পথই ডিপোজিট অটো-ক্রেডিট করে না (সবই ম্যানুয়াল অনুমোদন),
 *   তাই এই গার্ড আজ কিছুই আটকায় না। কিন্তু Group E-র গেটওয়ে ও
 *   `decideDepositApproval()` নীতি-স্তর ঠিক সেই পথটিই তৈরি করছে,
 *   আর সেটি চালু হওয়ার দিনই hold-এর দরকার পড়বে — তার আগে নয়।
 *   গার্ডটি **এখনই** বসানো হলো যাতে ঐ পথ লেখার সময় কেউ এটি
 *   যোগ করতে ভুলে না যায়; ভুললে ঝুঁকিপূর্ণ দাবিও নীরবে ক্রেডিট হতো।
 */
export function canAutoCreditDeposit(deposit: { riskHeldAt: Date | null }): boolean {
  return deposit.riskHeldAt === null;
}
