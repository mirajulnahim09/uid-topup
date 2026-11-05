import type { Metadata } from 'next';
import AdminPageHeader from '@/components/admin/AdminPageHeader';
import TelegramGate from '@/components/admin/telegram/TelegramGate';
import {
  TELEGRAM_EVENTS, getEventFlags, getStats, getConnectionStatus,
  getAllBots, toPublic, hasDbConfig,
} from '@/lib/telegram';
import { isSecretBoxReady } from '@/lib/secretbox';
import { requireAdminPage } from '@/lib/pageGuard';

export const metadata: Metadata = { title: 'টেলিগ্রাম' };
export const dynamic = 'force-dynamic';

/**
 * ★ /admin/telegram — টেলিগ্রাম ব্যবস্থাপনার একক কেন্দ্র।
 *
 *   ⚠️⚠️ এই পাতা ক্লায়েন্ট কম্পোনেন্টকে যা দেয় তার সবই **ব্রাউজারে
 *   যায়** (RSC payload)। তাই বট টোকেন এখানে কখনো আসে না — `toPublic()`
 *   টোকেন বাদ দিয়ে শুধু মাস্কড রূপ পাঠায়।
 *
 *   কনফিগ না থাকলে `TelegramGate` স্বয়ংক্রিয়ভাবে Connection Wizard
 *   দেখায়, নাহলে ড্যাশবোর্ড।
 */
export default async function AdminTelegramPage() {
  // ★ SEC-01 — পাতার নিজস্ব DB-গার্ড (সফট-নেভিগেশনে লেআউট চলে না)
  await requireAdminPage();
  const [conn, bots, stats, flags, dbConfigured] = await Promise.all([
    getConnectionStatus(),
    getAllBots(),
    getStats(),
    getEventFlags(),
    hasDbConfig(),
  ]);

  const data = {
    connection: {
      configured: conn.configured,
      connected: conn.connected,
      tokenValid: conn.tokenValid,
      unreachable: conn.unreachable,
      hasToken: conn.hasToken,
      hasChatId: conn.hasChatId,
      error: conn.error,
      latencyMs: conn.latencyMs,
      source: conn.source,
      // পরিচয় ক্যাশ থেকেও নেওয়া যায় — নেটওয়ার্ক পড়ে গেলে UI ফাঁকা হবে না
      botName: conn.identity?.name ?? bots[0]?.name ?? null,
      botUsername: conn.identity?.username ?? bots[0]?.username ?? null,
      botId: conn.identity?.id ?? bots[0]?.botId ?? null,
      photoUrl: bots[0]?.photoUrl ?? null,
    },
    bots: bots.map(toPublic),
    stats,
    enabled: flags.enabled,
    events: TELEGRAM_EVENTS.map((e) => ({
      key: e.key, group: e.group as string, label: e.label,
      hint: e.hint, wired: e.wired as boolean, enabled: flags.events[e.key],
    })),
    storage: {
      dbConfigured,
      encryptionReady: isSecretBoxReady(),
      source: conn.source,
    },
  };

  return (
    <div className="space-y-5">
      <AdminPageHeader
        title="টেলিগ্রাম"
        subtitle="অপারেটর নোটিফিকেশন — নতুন অর্ডার, রিচার্জ ও সতর্কতা সরাসরি আপনার টেলিগ্রামে। সব কনফিগ এখান থেকেই, কোনো ফাইল সম্পাদনা ছাড়াই।"
      />
      <TelegramGate initial={data} />
    </div>
  );
}
