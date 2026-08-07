import { requireAdmin, apiError, ApiError, readJson } from '@/lib/guard';
import { rateLimit, getIp } from '@/lib/rateLimit';
import { getMe, getChat, getBotPhotoDataUri, getPrimaryBot } from '@/lib/telegram';

export const dynamic = 'force-dynamic';

/**
 * ★★★ উইজার্ড যাচাই — ধাপ ২ (টোকেন) ও ধাপ ৩ (chat_id)
 *
 *   ── টোকেন এখানে বডিতে আসে, এটি কি নিরাপত্তা-লঙ্ঘন? না। ──
 *   অ্যাডমিন টোকেনটি নিজে টাইপ/পেস্ট করছে, অর্থাৎ সে **ইতিমধ্যেই
 *   জানে**। বিপজ্জনক দিকটি উল্টো: সার্ভার → ব্রাউজার। সেই নিয়ম
 *   অটুট — কোনো রেসপন্সে কখনো টোকেন ফেরত যায় না।
 *
 *   ⚠️ যাচাইয়ের সময় টোকেন **সংরক্ষণ করা হয় না**। সংরক্ষণ হয় শুধু
 *   `/connect`-এ, এবং তখন এনক্রিপ্ট হয়ে।
 */

/** টোকেনের গঠন পরীক্ষা — নেটওয়ার্কে যাওয়ার আগেই স্পষ্ট বার্তা */
function inspectToken(raw: string): { token: string; error?: string } {
  const token = raw.trim().replace(/^["']|["']$/g, '').trim();

  if (!token) return { token, error: 'টোকেন লিখুন' };

  // ★ অদৃশ্য অক্ষর আলাদা করে ধরা — কপি-পেস্টে সবচেয়ে সাধারণ ভুল,
  //   আর "Unauthorized" বার্তা এর কারণ কখনোই বুঝিয়ে দিত না।
  if (/[\r\n\t]/.test(raw)) {
    return { token, error: 'টোকেনে newline/tab আছে — শুধু টোকেনটুকু কপি করুন' };
  }
  if (/\s/.test(token)) {
    return { token, error: 'টোকেনের মাঝে ফাঁকা জায়গা আছে' };
  }
  if (!token.includes(':')) {
    return { token, error: 'ফরম্যাট ভুল — টোকেন দেখতে এমন: 123456789:AAH…' };
  }
  const [id, secret] = token.split(':');
  if (!/^\d{6,12}$/.test(id)) {
    return { token, error: 'কোলনের আগের অংশ শুধু সংখ্যা হওয়ার কথা (bot id)' };
  }
  if (!/^[A-Za-z0-9_-]{30,}$/.test(secret || '')) {
    return { token, error: 'কোলনের পরের অংশ ছোট বা অবৈধ অক্ষর আছে' };
  }
  return { token };
}

export async function POST(req: Request) {
  try {
    const admin = await requireAdmin();

    // ★ যাচাই তৃতীয় পক্ষের API-তে যায় — অপব্যবহার ঠেকাতে সীমা
    const rl = await rateLimit(`tgverify:${admin.id}`, 30, 300);
    if (!rl.ok) {
      throw new ApiError(`অনেক বেশি চেষ্টা। ${rl.retryAfter} সেকেন্ড পর আবার।`, 429);
    }
    void getIp(req);

    const body = await readJson<{ kind?: string; token?: string; chatId?: string }>(req);

    // ───────── ধাপ ২: টোকেন ─────────
    if (body.kind === 'token') {
      const { token, error } = inspectToken(String(body.token ?? ''));
      if (error) {
        return Response.json({ ok: false, stage: 'format', error }, { status: 200 });
      }

      const r = await getMe(token);
      if (!r.ok || !r.result) {
        return Response.json({
          ok: false,
          stage: r.unreachable ? 'network' : 'rejected',
          error: r.unreachable
            ? `টেলিগ্রামে পৌঁছানো যায়নি: ${r.description || 'অজানা'} — টোকেন ভুল বলে প্রমাণিত হয়নি`
            : r.description === 'Unauthorized'
              ? 'টেলিগ্রাম টোকেনটি প্রত্যাখ্যান করেছে — @BotFather থেকে আবার কপি করুন'
              : r.description || `HTTP ${r.status}`,
          latencyMs: r.latencyMs,
        }, { status: 200 });
      }

      // প্রোফাইল ছবি — data: URI, কারণ টেলিগ্রামের ফাইল-URL-এ টোকেন থাকে
      const photo = await getBotPhotoDataUri(token, r.result.id);

      return Response.json({
        ok: true,
        bot: {
          id: r.result.id,
          username: r.result.username,
          name: r.result.name,
          canJoinGroups: r.result.canJoinGroups,
          photoUrl: photo,
        },
        latencyMs: r.latencyMs,
      });
    }

    // ───────── ধাপ ৩: chat_id ─────────
    if (body.kind === 'chat') {
      const chatId = String(body.chatId ?? '').trim();
      if (!chatId) return Response.json({ ok: false, error: 'Chat ID লিখুন' });
      if (!/^-?\d+$/.test(chatId) && !chatId.startsWith('@')) {
        return Response.json({
          ok: false,
          error: 'Chat ID সংখ্যা হওয়ার কথা (গ্রুপ/চ্যানেলে ঋণাত্মক), অথবা @username',
        });
      }

      // ★ টোকেন বডিতে এলে সেটি (উইজার্ডে এখনো সেভ হয়নি), নাহলে সেভ করা বট
      let token = String(body.token ?? '').trim();
      if (!token) {
        const bot = await getPrimaryBot();
        token = bot?.token ?? '';
      }
      if (!token) throw new ApiError('আগে বট টোকেন যাচাই করুন', 400);

      const r = await getChat(token, chatId);
      if (!r.ok || !r.result) {
        return Response.json({
          ok: false,
          error: r.unreachable
            ? `টেলিগ্রামে পৌঁছানো যায়নি: ${r.description || 'অজানা'}`
            : r.description === 'Bad Request: chat not found'
              ? 'এই চ্যাট পাওয়া যায়নি — বটকে গ্রুপে যোগ করেছেন তো? ব্যক্তিগত চ্যাট হলে আগে বটকে /start দিন।'
              : r.description || `HTTP ${r.status}`,
          latencyMs: r.latencyMs,
        }, { status: 200 });
      }

      const TYPE_LABEL: Record<string, string> = {
        private: 'ব্যক্তিগত চ্যাট',
        group: 'গ্রুপ',
        supergroup: 'সুপারগ্রুপ',
        channel: 'চ্যানেল',
      };

      return Response.json({
        ok: true,
        chat: {
          id: String(r.result.id),
          type: r.result.type,
          typeLabel: TYPE_LABEL[r.result.type] || r.result.type,
          title: r.result.title,
          username: r.result.username,
        },
        latencyMs: r.latencyMs,
      });
    }

    throw new ApiError('অজানা যাচাই ধরন', 400);
  } catch (e) {
    return apiError(e);
  }
}
