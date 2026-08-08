import { prisma } from './prisma';

/**
 * ★★★ সেটিংস ক্যাশ (4.6)
 *
 *   ── আগে কেন ক্যাশ ছিল না ──
 *   `CLAUDE.md` §15 বলত ক্যাশ না থাকাটা "accepted tradeoff"। কিন্তু
 *   সেটিংস প্রায় প্রতিটি সার্ভার-রেন্ডারে লাগে (SLA, সাইটের নাম,
 *   পেমেন্ট নাম্বার), আর প্রতিবার DB-তে যাওয়া মানে প্রতিটি পাতায়
 *   বাড়তি রাউন্ড-ট্রিপ — Neon-এর মতো দূরের ডাটাবেসে যা বেশ ব্যয়বহুল।
 *
 *   ── কেন TTL খুবই ছোট (৩০ সেকেন্ড) ──
 *   ⚠️ এখানে সবচেয়ে সংবেদনশীল মান হলো **পেমেন্ট নাম্বার**। অ্যাডমিন
 *   bKash নাম্বার বদলানোর পর যদি পুরনো নাম্বার দেখানো চলতে থাকে,
 *   গ্রাহক **ভুল জায়গায় টাকা পাঠাবে** — সেই টাকা ফেরানো যায় না।
 *   তাই দীর্ঘ ক্যাশ এখানে গ্রহণযোগ্য নয়; ৩০ সেকেন্ড হলো সেই সীমা
 *   যেখানে খরচ বাঁচে অথচ ভুল নাম্বারের জানালা কার্যত নগণ্য।
 *
 *   ⚠️ লেখার সাথে সাথেই `invalidateSettings()` ডাকা হয় (settings ও
 *   payment রুট থেকে), তাই একই ইনস্ট্যান্সে পরিবর্তন **তাৎক্ষণিক**।
 *   TTL কেবল serverless-এর অন্য ইনস্ট্যান্সগুলোর জন্য শেষ রক্ষাকবচ —
 *   সেখানে ইনস্ট্যান্স-পার ক্যাশ আলাদা, তাই invalidate পৌঁছায় না।
 */

const TTL_MS = 30_000;

let cache: { at: number; data: Record<string, string> } | null = null;
let inFlight: Promise<Record<string, string>> | null = null;

/** ★ সেটিংস বদলালে সাথে সাথে ডাকতে হবে */
export function invalidateSettings(): void {
  cache = null;
}

export async function getSettings(): Promise<Record<string, string>> {
  if (cache && Date.now() - cache.at < TTL_MS) return cache.data;

  // ★ একই মুহূর্তে একাধিক অনুরোধ এলে DB-তে একবারই যাওয়া
  if (inFlight) return inFlight;

  inFlight = (async () => {
    try {
      // ★ শুধু প্রকৃত সাইট-সেটিংস — internal namespaced key (webhook:,
      //   idempotency marker ইত্যাদি) বাদ। নাহলে সেগুলো settings cache
      //   ফুলিয়ে দিত (webhook বাড়লে প্রতি refresh এ বড় ডেটা লোড)।
      //   ⚠️ startsWith ফিল্টার নয় — DB-লেভেলে `not contains ':'` দিয়ে
      //      কমানো হয়; আসল সেটিংস-কী-তে কোলন থাকে না (flag_/home_/pay_/…)।
      //
      // ★★★ Group E — `pp_*` (পেমেন্ট-গেটওয়ে ক্রেডেনশিয়াল) **এখানেই**
      //   বাদ, প্রতিটি কল-সাইটে নয়।
      //
      //   ⚠️ কেন এটি জরুরি: `/admin/site` ও `/admin/homepage` পুরো
      //   settings মানচিত্র একটি **ক্লায়েন্ট** কম্পোনেন্টে props হিসেবে
      //   পাঠায়। ক্লায়েন্ট-props RSC payload-এ সিরিয়ালাইজ হয়ে ব্রাউজারে
      //   যায়, অর্থাৎ view-source-এ প্লেইনটেক্সট। `site/page.tsx` কেবল
      //   দুটি টেলিগ্রাম কী redact করত — পেমেন্ট-কী নয়। মাপা হয়েছে:
      //   একটি ডামি SSLCommerz পাসওয়ার্ড বসিয়ে অ্যাডমিন পাতার HTML-এ
      //   হুবহু খুঁজে পাওয়া গেছে (tests/payment-config.test.ts)।
      //
      //   কল-সাইটে redact করা যেত, কিন্তু তাতে প্রতিটি নতুন কল-সাইটে
      //   একই কথা মনে রাখতে হতো — একবার ভুললেই আবার ফাঁস। এখানে বাদ
      //   দিলে গোপন মান settings-এ **ঢোকেই না**, তাই ভোলার সুযোগ নেই।
      const rows = await prisma.setting.findMany({
        where: {
          AND: [
            { NOT: { key: { contains: ':' } } },
            { NOT: { key: { startsWith: 'pp_' } } },
          ],
        },
      });
      if (!Array.isArray(rows)) return {};
      const data = Object.fromEntries(
        rows.map((r: (typeof rows)[number]) => [r.key, r.value])
      );
      cache = { at: Date.now(), data };
      return data;
    } catch {
      // ★ DB না পেলে ক্যাশ **লেখা হয় না** — নাহলে একটি ক্ষণস্থায়ী
      //   বিভ্রাট ৩০ সেকেন্ড ধরে "সেটিংস নেই" অবস্থা আটকে রাখত
      return {};
    } finally {
      inFlight = null;
    }
  })();

  return inFlight;
}

export async function getSetting(key: string, fallback = ''): Promise<string> {
  try {
    // ★ একই ক্যাশ ব্যবহার — আলাদা কোয়েরি করলে ক্যাশের মানেই থাকত না
    const all = await getSettings();
    return all[key] ?? fallback;
  } catch {
    return fallback;
  }
}
