import { prisma } from './prisma';
import { logger } from './logger';
import type { SlaConfig } from './sla';
import { isWithinSupportHours, nextOpening, formatDuration } from './sla';
import { APP_TIME_ZONE } from './date';

/**
 * ═══════════════════════════════════════════════════════════
 * ★ প্রকৃত পরিচালন-অবস্থা (2.17)
 *
 *   কেন (MANUAL_WORKFLOW.md A2 ও B7):
 *   ম্যানুয়াল ব্যবসায় কখনো কিউ জমে যায়, কখনো অ্যাডমিন ঘুমায়।
 *   তখন চুপ করে থাকলে গ্রাহক অর্ডার দেয়, অপেক্ষা করে, তারপর
 *   প্রতারিত বোধ করে। আগেই সৎভাবে বলে দিলে সে হয় অপেক্ষা করতে
 *   রাজি হয়, নয়তো পরে আসে — দুটোই অভিযোগের চেয়ে ভালো।
 *
 *   ★★★ এটি হাতে লেখা নোটিশ নয় — বাস্তব তথ্য থেকে হিসাব করা:
 *       • এখন কি অফিস খোলা? (সেটিংসের সময় + ঢাকা ঘড়ি)
 *       • কতগুলো অর্ডার/ডিপোজিট অপেক্ষা করছে?
 *       • সবচেয়ে পুরনোটি কতক্ষণ ধরে বসে আছে?
 *
 *   ফলে অ্যাডমিন "ব্যস্ত" লেখা আপডেট করতে ভুলে গেলেও গ্রাহক
 *   সঠিক তথ্যই দেখে।
 * ═══════════════════════════════════════════════════════════
 */

export type OpsStatus = {
  /** 'open' = স্বাভাবিক, 'busy' = দেরি হচ্ছে, 'closed' = অফিস বন্ধ */
  level: 'open' | 'busy' | 'closed';
  message: string;
  /**
   * ★ হিরোর ব্যাজের জন্য সংক্ষিপ্ত রূপ — **একই সত্যের** ছোট বাক্য।
   *
   *   কেন এটি এখানে, হিরোতে নয়: আগে হিরো নিজের একটি স্থির বাক্য
   *   দেখাত ("অপারেটর অনলাইন — অর্ডার এলে এখনই যাচাই"), আর ঠিক
   *   ১৫০px উপরে এই ব্যানার বলত "ব্যস্ত — ডেলিভারিতে বেশি সময়
   *   লাগছে"। এক পর্দায় দুটি পরস্পরবিরোধী দাবি — ভিড়ের চেয়েও বড়
   *   ক্ষতি আস্থার। দুটি বাক্যের উৎস এখন একটিই ফাংশন, তাই আর
   *   কখনো আলাদা কথা বলতে পারে না।
   */
  short: string;
};

/** এতগুলোর বেশি অপেক্ষমান থাকলে "ব্যস্ত" ধরা হয় */
const BUSY_QUEUE_THRESHOLD = 15;
/** সবচেয়ে পুরনো কাজ এত মিনিটের বেশি বসে থাকলে "ব্যস্ত" */
const BUSY_AGE_MINUTES = 45;

function dhakaClock(d: Date): string {
  return d.toLocaleTimeString('en-GB', {
    timeZone: APP_TIME_ZONE,
    hour: '2-digit',
    minute: '2-digit',
    hour12: true,
  });
}

/**
 * ★ কখনো throw করে না — DB সমস্যা হলে null, তখন ব্যানার দেখানো
 *   হয় না। ভুল তথ্যের চেয়ে নীরবতা ভালো।
 */
export async function getOpsStatus(cfg: SlaConfig): Promise<OpsStatus | null> {
  try {
    const now = new Date();

    // ── অফিস বন্ধ? ──
    if (!isWithinSupportHours(cfg, now)) {
      const opensAt = nextOpening(cfg, now);
      return {
        level: 'closed',
        message:
          `এখন আমাদের অফিস বন্ধ — অর্ডার নেওয়া চালু আছে, ` +
          `প্রসেসিং শুরু হবে ${dhakaClock(opensAt)} থেকে।`,
        short: `অফিস বন্ধ — অর্ডার নেওয়া চালু`,
      };
    }

    // ── খোলা: কিউ কত বড় ও কত পুরনো? ──
    const [pendingOrders, pendingDeposits, oldest] = await Promise.all([
      prisma.order.count({ where: { status: { in: ['PENDING', 'PROCESSING'] } } }),
      prisma.deposit.count({ where: { status: 'PENDING' } }),
      prisma.order.findFirst({
        where: { status: { in: ['PENDING', 'PROCESSING'] } },
        orderBy: { createdAt: 'asc' },
        select: { createdAt: true },
      }),
    ]);

    const queue = pendingOrders + pendingDeposits;
    const oldestMinutes = oldest
      ? Math.floor((now.getTime() - oldest.createdAt.getTime()) / 60000)
      : 0;

    if (queue >= BUSY_QUEUE_THRESHOLD || oldestMinutes >= BUSY_AGE_MINUTES) {
      /**
       * ★ সৎ পূর্বাভাস — কিন্তু **নতুন** অর্ডারের জন্য।
       *
       * ⚠️ আগে এটি ছিল `max(typical*2, oldestMinutes)` — কোনো ছাদ ছাড়া।
       *   কিউয়ের সবচেয়ে পুরনো কাজটি একবার আটকে গেলে (বাতিল হয়নি,
       *   কেউ ধরেওনি) সেটির বয়সই "আনুমানিক" হয়ে যেত: হোমপেজে মাপা
       *   হয়েছে **"আনুমানিক ৬৬ ঘন্টা ৩৬ মিনিট"**। এটি দুই দিক থেকেই
       *   ভুল — (ক) একটি পুরনো আটকে-থাকা কাজের বয়স নতুন অর্ডারের
       *   অপেক্ষার সময় নয়, আর (খ) সংখ্যাটি অর্ডার-পাতায় দেওয়া
       *   নিজেদেরই SLA গ্যারান্টিকে (`maxMinutes`) মিথ্যা প্রমাণ করত।
       *
       *   তাই ছাদ = ঐ গ্যারান্টি নিজেই, আর ৫ মিনিটে গোল করা
       *   (“৬৬ মিনিট” জাতীয় ছদ্ম-নির্ভুলতা বিশ্বাসযোগ্য শোনায় না)।
       */
      const raw = Math.max(cfg.typicalMinutes * 2, oldestMinutes);
      const estimate = Math.ceil(Math.min(raw, cfg.maxMinutes) / 5) * 5;
      return {
        level: 'busy',
        message:
          `এখন অর্ডারের চাপ বেশি — ডেলিভারিতে সাধারণের চেয়ে একটু বেশি সময় ` +
          `লাগছে (আনুমানিক ${formatDuration(estimate)} পর্যন্ত)। আমরা দ্রুত এগোচ্ছি।`,
        short: 'চাপ বেশি — একটু সময় লাগছে',
      };
    }

    return {
      level: 'open',
      message: `এখন সরাসরি প্রসেসিং চলছে — সাধারণত ${formatDuration(cfg.typicalMinutes)}ে ডেলিভারি।`,
      short: 'অপারেটর অনলাইন — এখনই যাচাই',
    };
  } catch (e) {
    logger.error('opsStatus', 'failed', { err: e });
    return null;
  }
}
