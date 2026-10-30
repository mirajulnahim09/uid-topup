import { getSystemHealth } from '@/lib/health';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

/**
 * ★ হেলথ চেক (প্রোডাকশন) — আপটাইম মনিটর / লোড-ব্যালান্সার এখানে
 *   পিং করে দেখে সার্ভিস ও নির্ভরশীল সাবসিস্টেম চালু আছে কিনা।
 *
 *   GET /api/health
 *   200 → { status: 'ok', ... }        সব critical সাবসিস্টেম চালু
 *   503 → { status: 'degraded', ... }  কোনো critical (DB) অচল
 *
 *   ⚠️ কোনো সংবেদনশীল তথ্য দেয় না; auth লাগে না (মনিটর পাবলিক পিং করে)।
 *   ⚠️ পুরনো ইন্টিগ্রেশন যেন না ভাঙে — `db` ও `uptimeMs` ফিল্ড আগের
 *      মতোই রাখা হয়েছে (backward compatible); নতুন `subsystems` array যোগ।
 */
export async function GET() {
  const health = await getSystemHealth();

  const db = health.subsystems.find((s) => s.key === 'database');

  const body = {
    // ── backward compatible (পুরনো মনিটর এগুলো পড়ে) ──
    status: health.status,
    db: db?.state === 'up' ? 'up' : 'down',
    uptimeMs: health.totalMs,
    time: health.checkedAt,
    // ── প্রতিটি সাবসিস্টেমের **অবস্থা** — বিবরণ নয় ──
    // ★ `detail` ইচ্ছাকৃতভাবে বাদ। এটি পাবলিক, লগইন ছাড়া পড়া যায়, অথচ
    //   `detail` এ থাকে DB-র কাঁচা ত্রুটি-বার্তা (Prisma সেখানে ডাটাবেস-
    //   হোস্টের নাম লেখে — এই রানেই টার্মিনালে দেখা গেছে) ও কনফিগের
    //   ফাঁক ("SENTRY_DSN সেট নেই", "স্যান্ডবক্স প্রেরক") — আক্রমণকারীর
    //   জন্য মানচিত্র। মালিক পুরো বিবরণ দেখেন `/api/admin/readiness` এ।
    //   মনিটর যা পড়ে (`key`, `state`, `critical`) — অপরিবর্তিত।
    subsystems: health.subsystems.map(({ detail: _detail, ...pub }) => pub),
  };

  return Response.json(body, {
    status: health.status === 'ok' ? 200 : 503,
    headers: { 'Cache-Control': 'no-store' },
  });
}
