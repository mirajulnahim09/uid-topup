import { getServerSession } from 'next-auth';
import { requireUser, apiError, ApiError } from '@/lib/guard';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { logger } from '@/lib/logger';
import { isSessionRevoked } from '@/lib/sessionRevocation';

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

/**
 * ★★★ RT-01 — প্রতি ব্যবহারকারীর খোলা স্ট্রিমের সীমা।
 *   ⚠️ সৎভাবে: এটি **এই প্রসেস/ইনস্ট্যান্সের** গণনা — serverless-এ একাধিক
 *   ইনস্ট্যান্স থাকলে সীমাটি প্রতি-ইনস্ট্যান্স, বিশ্বব্যাপী নয়।
 */
const MAX_STREAMS_PER_USER = 3;
const openStreams = new Map<string, number>();

export async function GET() {
  try {
    const user = await requireUser();
    // ★ RT-01 — এই সেশনের id (লগআউট-যাচাইয়ের জন্য), অনুরোধের প্রসঙ্গেই পড়া
    const sid = (await getServerSession(authOptions))?.user?.sid;

    // ★ বন্ধ থাকলে ৫০৩ — ক্লায়েন্ট এটি দেখে পোলিং-এ ফিরে যায়
    if (!ENABLED) {
      return Response.json(
        { enabled: false, reason: 'STREAM_ENABLED সেট নেই — পোলিং ব্যবহার করুন' },
        { status: 503 },
      );
    }

    if ((openStreams.get(user.id) ?? 0) >= MAX_STREAMS_PER_USER) {
      throw new ApiError('অনেকগুলো লাইভ সংযোগ খোলা — কিছু ট্যাব বন্ধ করুন', 429);
    }
    openStreams.set(user.id, (openStreams.get(user.id) ?? 0) + 1);
    let released = false;
    const release = () => {
      if (released) return;
      released = true;
      const n = (openStreams.get(user.id) ?? 1) - 1;
      if (n <= 0) openStreams.delete(user.id); else openStreams.set(user.id, n);
    };

    const encoder = new TextEncoder();
    let epochAtConnect: number | null = null;
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
          release();
        };

        // ক্লায়েন্টকে পুনঃসংযোগের ব্যবধান জানাই
        controller.enqueue(encoder.encode(`retry: ${RETRY_MS}\n\n`));

        const tick = async (initial = false) => {
          try {
            const [me, unread, revoked] = await Promise.all([
              prisma.user.findUnique({
                where: { id: user.id },
                select: { balance: true, isBanned: true, sessionEpoch: true },
              }),
              prisma.notification.count({
                where: { userId: user.id, isRead: false },
              }),
              isSessionRevoked(sid),
            ]);
            /**
             * ★★★ RT-01 — আগে প্রমাণীকরণ কেবল সংযোগের শুরুতে: ব্যান/সব-ডিভাইস-
             *   সাইন-আউট/লগআউটের পরেও খোলা স্ট্রিম ব্যালেন্স পাঠাতে থাকত (আয়ু পর্যন্ত)।
             *   এখন প্রতি টিকে একই শর্ত; ভাঙলে `revoked` জানিয়ে বন্ধ।
             */
            if (epochAtConnect === null && me) epochAtConnect = me.sessionEpoch;
            if (!me || me.isBanned || revoked || me.sessionEpoch !== epochAtConnect) {
              send('revoked', { reason: 'session' });
              cleanup();
              try { controller.close(); } catch { /* ইতিমধ্যে বন্ধ */ }
              return;
            }
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
        if (released) return; // ★ প্রথম টিকেই বাতিল — টাইমার চালু করার দরকার নেই
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
        release();
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
