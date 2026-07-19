import { prisma } from './prisma';
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
      // ★ সৎ পূর্বাভাস — স্বাভাবিকের চেয়ে বেশি সময় লাগবে বলে দিই
      const estimate = Math.max(cfg.typicalMinutes * 2, oldestMinutes);
      return {
        level: 'busy',
        message:
          `এখন অর্ডারের চাপ বেশি — ডেলিভারিতে সাধারণের চেয়ে বেশি সময় ` +
          `লাগছে (আনুমানিক ${formatDuration(estimate)})। আমরা দ্রুত এগোচ্ছি।`,
      };
    }

    return {
      level: 'open',
      message: `এখন সরাসরি প্রসেসিং চলছে — সাধারণত ${formatDuration(cfg.typicalMinutes)}ে ডেলিভারি।`,
    };
  } catch (e) {
    console.error('[opsStatus] failed:', e);
    return null;
  }
}
