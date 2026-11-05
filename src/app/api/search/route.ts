import { apiError, ApiError } from '@/lib/guard';
import { rateLimit, LIMITS, getIp } from '@/lib/rateLimit';
import { normalizeQuery, SEARCH_MIN_LEN } from '@/lib/search';
import { searchProducts } from '@/lib/services/search';

/**
 * ═══════════════════════════════════════════════════════════
 * ★ পাবলিক সার্চ (Group I ১) — `GET /api/search?q=…`
 *
 *   ⚠️ ইচ্ছাকৃতভাবে **অননুমোদিত**: দোকানের ক্যাটালগ এমনিতেই সবার
 *   জন্য খোলা (হোমপেজ, প্রোডাক্ট পাতা, sitemap)। লগইন চাইলে সার্চ
 *   ক্যাটালগের চেয়ে **কম** খোলা হতো, অথচ তথ্য একই।
 *
 *   ⚠️ কিন্তু সীমাহীন নয় — প্রতিটি কল একটি DB কোয়েরি, আর `contains`
 *   কোয়েরি ইনডেক্স ব্যবহার করে না। IP-ভিত্তিক সীমা তাই এখানে
 *   কার্যত একটি খরচ-নিয়ন্ত্রণ (Neon-এ সংযোগ সীমিত — H4)।
 * ═══════════════════════════════════════════════════════════
 */

/**
 * ⚠️ **`force-dynamic` ইচ্ছাকৃত।** রুটটি `getIp(req)` দিয়ে হেডার পড়ে,
 *   কিন্তু কোনো সেশন/কুকি পড়ে না — তাই Next একে **স্ট্যাটিক** ধরে
 *   prerender করার চেষ্টা করত, রেন্ডারের সময় `headers` দেখে থেমে যেত,
 *   আর সেই ব্যর্থতা অ্যাপের **নিজের** লগারে `level:error` হিসেবে
 *   প্রতিটি বিল্ডে ছাপা হতো। আচরণ ঠিকই ছিল (রুট ডাইনামিকই চলত),
 *   কিন্তু একটি স্থায়ী মিথ্যা-ত্রুটি বিল্ড-লগে থাকত — আর Sentry যুক্ত
 *   হলে (Phase 4b) প্রতিটি ডিপ্লয়ে একটি ভুয়া ত্রুটি যেত।
 *   অন্য GET রুটগুলো (`account/withdraw`, `admin/user/api-key`) সেশন
 *   পড়ে বলে Next এমনিতেই ডাইনামিক ধরে; এটিই একমাত্র ব্যতিক্রম ছিল।
 */
export const dynamic = 'force-dynamic';
export async function GET(req: Request) {
  try {
    const rl = await rateLimit(`search:${getIp(req)}`, LIMITS.search.limit, LIMITS.search.window);
    if (!rl.ok) {
      throw new ApiError(`একটু ধীরে — ${rl.retryAfter} সেকেন্ড পর আবার চেষ্টা করুন।`, 429);
    }

    const raw = new URL(req.url).searchParams.get('q');

    // ★ ছোট প্রশ্নে **কোয়েরিই চালাই না** — খালি ফল, ত্রুটি নয়।
    //   টাইপ করার সময় প্রতিটি অক্ষরে একটি ৪০০ পাঠানো মানে কনসোল
    //   ভরে যাওয়া, অথচ ব্যবহারকারী কেবল লিখছেন।
    if (!normalizeQuery(raw)) {
      return Response.json({ query: (raw ?? '').trim(), results: [], minLength: SEARCH_MIN_LEN });
    }

    const results = await searchProducts(raw);
    return Response.json({ query: (raw ?? '').trim(), results });
  } catch (e) {
    return apiError(e);
  }
}
