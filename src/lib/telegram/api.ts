/**
 * ═══════════════════════════════════════════════════════════
 * ★ টেলিগ্রাম HTTP স্তর — একমাত্র জায়গা যেখানে টোকেন URL-এ বসে।
 *
 *   এখানকার সব ত্রুটি-বার্তা `scrub()` দিয়ে ছাঁকা, কারণ টোকেন
 *   থাকে URL-এর ভেতরে আর কিছু fetch ত্রুটি পুরো URL জুড়ে দেয়।
 * ═══════════════════════════════════════════════════════════
 */

export const TELEGRAM_TIMEOUT_MS = 8000;
const MAX_ATTEMPTS = 3;
const MAX_RETRY_AFTER_MS = 5000;

/**
 * ★★★ গোপন তথ্য মুছে ফেলা।
 *
 *   ⚠️ শুরুতে `\b` ব্যবহার করা যাবে **না** — `…/bot8801466881:AA…`-তে
 *   সংখ্যার আগের অক্ষর `t`, দুটোই word-char, তাই সেখানে word boundary
 *   নেই এবং `\b` দিলে সবচেয়ে জরুরি কেসটাই ফসকে যায়।
 */
export function scrub(s: string): string {
  return s.replace(/(?<!\d)\d{6,12}:[A-Za-z0-9_-]{20,}/g, '<token:redacted>');
}

export type ApiCall<T = unknown> = {
  ok: boolean;
  status: number;
  result?: T;
  description?: string;
  /** রাউন্ড-ট্রিপ সময় (ms) — ড্যাশবোর্ডে latency হিসেবে দেখানো হয় */
  latencyMs: number;
  /** নেটওয়ার্কে পৌঁছানোই যায়নি (টাইমআউট/DNS) — API প্রত্যাখ্যান নয় */
  unreachable: boolean;
  /** কতবার চেষ্টা লেগেছে */
  attempts: number;
};

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * একটি টেলিগ্রাম API মেথড ডাকে — টাইমআউট, পুনঃচেষ্টা ও সময়-মাপ সহ।
 *
 * পুনঃচেষ্টা: নেটওয়ার্ক ত্রুটি ও 5xx → backoff; 429 → `retry_after` মেনে;
 * অন্য 4xx → **নয়** (একই অনুরোধ আবার পাঠালেও একই ফল)।
 */
export async function callTelegram<T = unknown>(
  token: string,
  method: string,
  body?: Record<string, unknown>,
): Promise<ApiCall<T>> {
  const started = Date.now();
  let last: ApiCall<T> = {
    ok: false, status: 0, latencyMs: 0, unreachable: true, attempts: 0,
    description: 'অজানা ত্রুটি',
  };

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TELEGRAM_TIMEOUT_MS);
    try {
      const res = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
        method: body ? 'POST' : 'GET',
        headers: body ? { 'Content-Type': 'application/json' } : undefined,
        body: body ? JSON.stringify(body) : undefined,
        signal: controller.signal,
      });
      const data = (await res.json().catch(() => ({}))) as {
        ok?: boolean; result?: T; description?: string;
        parameters?: { retry_after?: number };
      };

      last = {
        ok: Boolean(data.ok),
        status: res.status,
        result: data.result,
        description: data.description ? scrub(data.description) : undefined,
        latencyMs: Date.now() - started,
        unreachable: false,
        attempts: attempt,
      };

      if (data.ok) return last;

      if (res.status === 429 && attempt < MAX_ATTEMPTS) {
        await sleep(Math.min((data.parameters?.retry_after ?? 1) * 1000, MAX_RETRY_AFTER_MS));
        continue;
      }
      if (res.status >= 500) {
        // ★ টেলিগ্রামের নিজের সমস্যা — টোকেনের রায় নয়
        last.unreachable = true;
        if (attempt < MAX_ATTEMPTS) {
          await sleep(300 * attempt * attempt);
          continue;
        }
      }
      return last;
    } catch (e) {
      const isAbort = e instanceof Error && e.name === 'AbortError';
      last = {
        ok: false,
        status: 0,
        description: scrub(
          isAbort
            ? `টেলিগ্রাম সাড়া দেয়নি (${TELEGRAM_TIMEOUT_MS}ms টাইমআউট)`
            : e instanceof Error ? e.message : 'অজানা ত্রুটি',
        ),
        latencyMs: Date.now() - started,
        unreachable: true,
        attempts: attempt,
      };
      if (attempt < MAX_ATTEMPTS) {
        await sleep(300 * attempt * attempt);
        continue;
      }
    } finally {
      clearTimeout(timer);
    }
  }

  return last;
}

export type BotIdentity = {
  id: number;
  username: string;
  name: string;
  canJoinGroups: boolean;
  canReadAllGroupMessages: boolean;
};

/** getMe — টোকেন যাচাই ও বটের প্রকাশ্য পরিচয় */
export async function getMe(token: string): Promise<ApiCall<BotIdentity>> {
  const r = await callTelegram<{
    id: number; username?: string; first_name?: string;
    can_join_groups?: boolean; can_read_all_group_messages?: boolean;
  }>(token, 'getMe');

  if (!r.ok || !r.result) return r as unknown as ApiCall<BotIdentity>;
  return {
    ...r,
    result: {
      id: r.result.id,
      username: r.result.username || '',
      name: r.result.first_name || '',
      canJoinGroups: Boolean(r.result.can_join_groups),
      canReadAllGroupMessages: Boolean(r.result.can_read_all_group_messages),
    },
  };
}

export type ChatInfo = {
  id: number | string;
  type: string;
  title: string;
  username: string | null;
};

/** getChat — গন্তব্য চ্যাট যাচাই (ব্যক্তিগত/গ্রুপ/সুপারগ্রুপ/চ্যানেল) */
export async function getChat(token: string, chatId: string): Promise<ApiCall<ChatInfo>> {
  const r = await callTelegram<{
    id: number; type: string; title?: string;
    username?: string; first_name?: string; last_name?: string;
  }>(token, 'getChat', { chat_id: chatId });

  if (!r.ok || !r.result) return r as unknown as ApiCall<ChatInfo>;
  const c = r.result;
  const personal = [c.first_name, c.last_name].filter(Boolean).join(' ');
  return {
    ...r,
    result: {
      id: c.id,
      type: c.type,
      title: c.title || personal || c.username || String(c.id),
      username: c.username || null,
    },
  };
}

/**
 * বটের প্রোফাইল ছবি — `getUserProfilePhotos` → `getFile`।
 *
 *   ⚠️ ফেরত দেওয়া URL-এ **টোকেন থাকে** (`/file/bot<TOKEN>/…`), তাই
 *   এটি কখনোই ব্রাউজারে পাঠানো যাবে না। এই কারণেই ছবিটি সার্ভারে
 *   এনে **data: URI** হিসেবে ফেরত দেওয়া হয় — ক্লায়েন্ট টোকেন ছাড়াই
 *   ছবি দেখতে পায়। (নিরাপত্তা-সিদ্ধান্ত, সুবিধা নয়।)
 */
export async function getBotPhotoDataUri(token: string, botId: number): Promise<string | null> {
  try {
    const photos = await callTelegram<{
      total_count: number;
      photos: { file_id: string; width: number; height: number }[][];
    }>(token, 'getUserProfilePhotos', { user_id: botId, limit: 1 });

    const first = photos.result?.photos?.[0];
    if (!photos.ok || !first || first.length === 0) return null;

    // সবচেয়ে ছোট আকারটিই যথেষ্ট (অ্যাভাটার) — কম ব্যান্ডউইথ
    const smallest = [...first].sort((a, b) => a.width * a.height - b.width * b.height)[0];

    const file = await callTelegram<{ file_path?: string }>(token, 'getFile', {
      file_id: smallest.file_id,
    });
    const path = file.result?.file_path;
    if (!file.ok || !path) return null;

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TELEGRAM_TIMEOUT_MS);
    try {
      const res = await fetch(`https://api.telegram.org/file/bot${token}/${path}`, {
        signal: controller.signal,
      });
      if (!res.ok) return null;
      const buf = Buffer.from(await res.arrayBuffer());
      // ★ ৩০০ KB-র বেশি হলে বাদ — data: URI HTML-এ ইনলাইন হয়, পাতা ভারী হতো
      if (buf.byteLength > 300_000) return null;
      const mime = res.headers.get('content-type') || 'image/jpeg';
      return `data:${mime};base64,${buf.toString('base64')}`;
    } finally {
      clearTimeout(timer);
    }
  } catch {
    // ছবি ঐচ্ছিক — ব্যর্থ হলে শুধু ছবি থাকবে না
    return null;
  }
}

/** sendMessage — HTML parse-mode */
export async function sendMessage(
  token: string,
  chatId: string,
  text: string,
): Promise<ApiCall<{ message_id: number; date: number }>> {
  return callTelegram<{ message_id: number; date: number }>(token, 'sendMessage', {
    chat_id: chatId,
    text,
    parse_mode: 'HTML',
    disable_web_page_preview: true,
  });
}

/** HTML parse-mode এর জন্য বিপজ্জনক অক্ষর escape */
export function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
