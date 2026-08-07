import { requireUser, apiError } from '@/lib/guard';
import { prisma } from '@/lib/prisma';
import { logger } from '@/lib/logger';

export const dynamic = 'force-dynamic';

/**
 * ═══════════════════════════════════════════════════════════
 * ★★★ H4 — Server-Sent Events: নোটিফিকেশন-সংখ্যা ও ব্যালেন্স পুশ
 *
 *   `GET /api/stream`  (লগইন করা ব্যবহারকারী)
 *
 *   ── কেন ঐচ্ছিক (`STREAM_ENABLED`) ──
 *   SSE একটি **দীর্ঘ-জীবী** সংযোগ। serverless হোস্টে ফাংশনের সর্বোচ্চ
 *   আয়ু থাকে; সেটি ছোট হলে সংযোগ বারবার কাটবে আর `EventSource`
 *   বারবার পুনঃসংযোগ করবে — তখন এটি পোলিং-এর **চেয়েও খারাপ**।
 *   এই প্রকল্প Vercel **Hobby**-তে চলে, যেখানে সীমা কড়া। তাই ডিফল্টে
 *   বন্ধ; ক্লায়েন্ট তখন দৃশ্যমানতা-সচেতন ১২০s পোলিং ব্যবহার করে
 *   (`useVisibleInterval`) — যা এমনিতেই আগের ৬০s always-on পোলিংয়ের
 *   চেয়ে অনেক কম DB ছোঁয়।
 *
 *   VPS / দীর্ঘ-চলমান সার্ভারে `STREAM_ENABLED=1` দিলে প্রকৃত পুশ চালু।
 *
 *   ── নকশা ──
 *   · প্রতি `POLL_MS` এ DB দেখা হয়, কিন্তু **বদলালে তবেই** পাঠানো হয়
 *     (অপরিবর্তিত হলে কেবল heartbeat) — ক্লায়েন্টে অকারণ re-render নেই
 *   · `MAX_LIFETIME_MS` পর নিজে থেকেই বন্ধ; `retry:` হিন্ট দিয়ে
 *     ক্লায়েন্টকে বলা হয় কত পরে ফিরতে — অসীম সংযোগ জমে না
 *   · `abort` সিগন্যালে টাইমার পরিষ্কার — নাহলে ট্যাব বন্ধের পরেও
 *     সার্ভারে কোয়েরি চলতে থাকত (লিক)
 * ═══════════════════════════════════════════════════════════
 */

const ENABLED = ['1', 'true', 'yes'].includes(
  (process.env.STREAM_ENABLED || '').trim().toLowerCase(),
);
/** কত পর পর DB দেখা হবে */
const POLL_MS = 20_000;
/** কত পরে সংযোগ নিজে থেকে বন্ধ হবে (প্ল্যাটফর্ম-সীমার নিচে) */
const MAX_LIFETIME_MS = 60_000;
/** ক্লায়েন্ট কত পরে পুনঃসংযোগ করবে */
const RETRY_MS = 15_000;

export async function GET() {
  try {
    const user = await requireUser();

    // ★ বন্ধ থাকলে ৫০৩ — ক্লায়েন্ট এটি দেখে পোলিং-এ ফিরে যায়
    if (!ENABLED) {
      return Response.json(
        { enabled: false, reason: 'STREAM_ENABLED সেট নেই — পোলিং ব্যবহার করুন' },
        { status: 503 },
      );
    }

    const encoder = new TextEncoder();
    let timer: ReturnType<typeof setInterval> | null = null;
    let closeTimer: ReturnType<typeof setTimeout> | null = null;
    let lastPayload = '';

    const stream = new ReadableStream({
      async start(controller) {
        const send = (event: string, data: unknown) => {
          controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
        };
        const cleanup = () => {
          if (timer) { clearInterval(timer); timer = null; }
          if (closeTimer) { clearTimeout(closeTimer); closeTimer = null; }
        };

        // ক্লায়েন্টকে পুনঃসংযোগের ব্যবধান জানাই
        controller.enqueue(encoder.encode(`retry: ${RETRY_MS}\n\n`));

        const tick = async (initial = false) => {
          try {
            const [me, unread] = await Promise.all([
              prisma.user.findUnique({
                where: { id: user.id },
                select: { balance: true },
              }),
              prisma.notification.count({
                where: { userId: user.id, isRead: false },
              }),
            ]);
            const payload = JSON.stringify({ balance: String(me?.balance ?? '0'), unread });

            // ★ বদলালে তবেই পাঠাই — নাহলে শুধু heartbeat
            if (payload !== lastPayload) {
              lastPayload = payload;
              send('update', JSON.parse(payload));
            } else if (!initial) {
              controller.enqueue(encoder.encode(': hb\n\n'));
            }
          } catch (e) {
            logger.error('stream', 'tick failed', { userId: user.id, err: e });
            // ★ একটি ব্যর্থ কোয়েরিতে স্ট্রিম ভাঙি না — পরের tick চেষ্টা করবে
          }
        };

        await tick(true);
        timer = setInterval(tick, POLL_MS);

        closeTimer = setTimeout(() => {
          cleanup();
          try { controller.close(); } catch { /* ইতিমধ্যে বন্ধ */ }
        }, MAX_LIFETIME_MS);
      },

      cancel() {
        // ★ ক্লায়েন্ট চলে গেছে (ট্যাব বন্ধ/নেভিগেশন) — টাইমার থামাই,
        //   নাহলে সার্ভারে অনাথ কোয়েরি চলতেই থাকত
        if (timer) { clearInterval(timer); timer = null; }
        if (closeTimer) { clearTimeout(closeTimer); closeTimer = null; }
      },
    });

    return new Response(stream, {
      headers: {
        'content-type': 'text/event-stream; charset=utf-8',
        'cache-control': 'no-store, no-transform',
        connection: 'keep-alive',
        // প্রক্সি যেন বাফার না করে (nginx)
        'x-accel-buffering': 'no',
      },
    });
  } catch (e) {
    return apiError(e);
  }
}
