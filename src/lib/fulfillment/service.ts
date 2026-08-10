import { getFulfillmentConfig, decideOrderApproval } from './policy';
import { hub } from '../integrations/hub';
import type { Delivery, FulfillmentJob } from '../integrations/types';

/**
 * ═══════════════════════════════════════════════════════════
 * ⚠️⚠️ **অপ্রচলিত (Group G, ১০ আগস্ট ২০২৬) — এর কোনো কল-সাইট নেই।**
 *
 *   `autoFulfill.ts` এর কাজটি সম্পূর্ণভাবে নিয়ে নিয়েছে এবং তার
 *   সাথে যা এখানে কখনো ছিল না তাও করে: claim, retry, timeout,
 *   idempotency, ও অবস্থা-পরিবর্তন। অর্ডার-সার্ভিস এখন সেটিকেই ডাকে।
 *
 *   ফাইলটি **রেখে দেওয়া হয়েছে ইচ্ছাকৃতভাবে** — CLAUDE.md §2.2(৬):
 *   মালিকের অনুমতি ছাড়া চলমান কোড মুছি না। মুছে ফেলার প্রস্তাব
 *   রিপোর্টে দেওয়া আছে। ⚠️ নতুন কোনো কোড এটিকে ডাকবে না —
 *   ডাকলে retry/claim/idempotency কিছুই পাবে না।
 * ───────────────────────────────────────────────────────────
 * ★★★ Fulfillment service — Order Service কেবল এই ইন্টারফেসের সাথে
 *   কথা বলে; কোনো নির্দিষ্ট fulfillment প্রোভাইডার জানে না (DIP)।
 *
 *   আজ: config=manual (ডিফল্ট) ও active provider=manual → সর্বদা
 *   `MANUAL` (মানুষ গেমে ডেলিভার করে) → বর্তমান অর্ডার-প্রবাহ হুবহু
 *   অপরিবর্তিত। ভবিষ্যতে একটি configured fulfillment gateway ও
 *   order_approval=automatic হলে কেবল তখনই অটো-ডেলিভারি চালু হবে —
 *   Order Service-এর কোড না বদলেই।
 * ═══════════════════════════════════════════════════════════
 */
export async function fulfillOrder(job: FulfillmentJob): Promise<Delivery> {
  try {
    const cfg = await getFulfillmentConfig();
    if (decideOrderApproval(cfg) !== 'automatic') return { status: 'MANUAL' };
    const provider = await hub.fulfillment();
    if (!provider) return { status: 'MANUAL' };
    return await provider.deliver(job);
  } catch {
    // নিরাপদ fallback — fulfillment স্তর কখনো money/order flow ভাঙবে না
    return { status: 'MANUAL' };
  }
}
