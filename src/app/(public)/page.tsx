import { prisma } from '@/lib/prisma';
import { getSettings } from '@/lib/settings';
import BannerSlider from '@/components/BannerSlider';
import StorefrontShell, { type HeroContent, type StoreExtras } from '@/components/home/StorefrontShell';
import StoreHowFaq from '@/components/home/StoreHowFaq';
import { getHeroCampaign, getCampaigns, getPopups, getSlides, getNotices, getFloatingCards } from '@/lib/campaigns';
import { getShowcase, type ShowcaseData } from '@/lib/showcase';
import { getRecentDeliveries } from '@/lib/liveActivity';
import { safeUrl } from '@/lib/sanitize';
import { slaFromSettings } from '@/lib/sla';
import { getOpsStatus } from '@/lib/opsStatus';
import OpsStatusBanner from '@/components/OpsStatusBanner';
import NoticeBar from '@/components/home/NoticeBar';
import CampaignSlider from '@/components/home/CampaignSlider';
import PopupHost from '@/components/home/PopupHost';
import FloatingCard from '@/components/home/FloatingCard';
import FloatingContact from '@/components/home/FloatingContact';

// ★ ৬০ সেকেন্ড ক্যাশ — দাম/প্রোডাক্ট বদলালে সাথে সাথে revalidate হয়
export const revalidate = 60;

/**
 * ═══════════════════════════════════════════════════════════
 * ★ HOMEPAGE — VOLT composition (Phase 1–6)
 *
 *   ⚠️ ডেটা স্তর সৎ ও নিজে-গার্ডেড: প্রতিটি উৎস (getShowcase,
 *   getRecentDeliveries, getTrustStats, campaigns) read-only আর DB
 *   সমস্যা হলে খালি ফেরে — throw নয়, তাই পাতা কখনো ভাঙে না।
 *   ব্যাজ/দামের যুক্তি সার্ভারেই (showcase.ts) হিসাব হয় (5.11), আর
 *   সব মার্কেটিং-কনটেন্ট অ্যাডমিন-নিয়ন্ত্রিত (Campaign + settings) —
 *   কিছুই হার্ডকোড বা বানানো নয়; ডেটা না থাকলে ঐ অংশ দেখায়ই না।
 *
 *   ─── পাতার ক্রম (২০২৬-০৯-২৫, `3_REFERENCE_COMBINED_BLUEPRINT.md`) ───
 *     অবস্থা → নোটিশ → ব্যানার (স্লাইডার / ব্যানার / নাহলে হিরো)
 *     → সাপোর্ট-চিপ → জনপ্রিয় → প্রতি ক্যাটাগরি একটি সেকশন
 *     → সাম্প্রতিক অর্ডার → কীভাবে অর্ডার · FAQ
 *
 *   তিনটি রেফারেন্স-সাইটের (uidtopup.com · topupbuzz.com ·
 *   fristtopup.com) সম্মিলিত কাঠামো — ক্যাটালগই হোমপেজ। প্রতিটি
 *   সেকশন হয় কোনো রেফারেন্সে আছে, নয়তো আমাদের বিদ্যমান ফিচার।
 *   (এই মন্তব্যে আগে যে "VOLT" সেকশনগুলোর — টিকার, টার্মিনাল,
 *   বেন্টো — বর্ণনা ছিল, সেগুলো git-ইতিহাসের আগেই সরে গিয়েছিল।)
 * ═══════════════════════════════════════════════════════════
 */

/**
 * ★ হিরোর কনটেন্ট — অ্যাডমিন-নিয়ন্ত্রিত, স্তরিত ফলব্যাক (Phase 2)
 *
 *   অগ্রাধিকার ক্রম (উপরেরটি আগে জেতে):
 *     ১. Campaign(placement=HERO) — Admin → হোমপেজ থেকে সেট করা
 *     ২. Settings hero_title/hero_subtitle — Admin → সেটিংস থেকে
 *        (তবে seed-প্লেসহোল্ডার হলে ধরা হয় "সেট করা হয়নি")
 *     ৩. সৎ, শক্তিশালী ডিফল্ট (নিচে)
 *
 *   ফলে প্রতিটি অংশ অ্যাডমিন-নিয়ন্ত্রিত, অথচ কিছু সেট না থাকলেও
 *   হিরো দুর্বল দেখায় না।
 */
const SEEDED_TITLE = 'ফ্রি ফায়ার ডায়মন্ড টপ আপ';
const SEEDED_SUBTITLE = 'কম দামে ভালো সার্ভিস';

/**
 * ★ ডিফল্ট — কেবল বিদ্যমান প্রবাহের তথ্য, কোনো স্লোগান বা দাবি নয়।
 *
 *   ২০২৬-০৯-২৫ (তিন-রেফারেন্স ব্লুপ্রিন্ট): আগের ডিফল্ট ছিল বানানো স্লোগান
 *   ("গেমে ফেরার দ্রুততম রাস্তা"), "সেকেন্ডেই" গতির দাবি, আর চারটি ডিফল্ট
 *   হাইলাইট যার একটি "না পেলে ১০০% ফেরত" — মালিকের অনুমোদন ছাড়া একটি
 *   আর্থিক প্রতিশ্রুতি। রেফারেন্সে টেক্সট-হিরোই নেই, তাই শিরোনাম এখন
 *   সাইটের নিজস্ব পরিচয়-বাক্য (seed-এর hero_title-এর সমান), আর হাইলাইট
 *   কেবল অ্যাডমিনের STRIP campaign থেকে — ডিফল্ট নেই।
 */
const DEFAULT_STATUS = 'অপারেটর অনলাইন — অর্ডার এলে এখনই যাচাই';
const DEFAULT_TITLE = SEEDED_TITLE;
const DEFAULT_SUBTITLE =
  'Player ID/UID দিন, bKash · Nagad · Rocket-এ পেমেন্ট করুন — অর্ডারের অবস্থা অ্যাকাউন্টে দেখুন।';
const DEFAULT_CTA = 'টপ-আপ করুন';

function settingOrNull(v: string | undefined, seed: string): string | null {
  const t = (v || '').trim();
  return !t || t === seed ? null : t;
}

async function buildHero(settings: Record<string, string>): Promise<{ content: HeroContent; highlights: string[]; adminBadge: boolean }> {
  // read-only, নিজে-গার্ডেড: DB সমস্যা হলে খালি/null ফেরে (throw নয়)
  const [hc, strips] = await Promise.all([getHeroCampaign(), getCampaigns('STRIP', 4)]);

  const content: HeroContent = {
    status: hc?.badge?.trim() || DEFAULT_STATUS,
    title: hc?.title?.trim() || settingOrNull(settings.hero_title, SEEDED_TITLE) || DEFAULT_TITLE,
    subtitle: hc?.subtitle?.trim() || settingOrNull(settings.hero_subtitle, SEEDED_SUBTITLE) || DEFAULT_SUBTITLE,
    ctaLabel: hc?.ctaLabel?.trim() || DEFAULT_CTA,
    ctaLink: hc?.ctaLink?.trim() || '#arsenal',
    imageUrl: hc?.imageUrl || null,
  };

  const highlights = strips
    .map((s) => (s.title || '').trim())
    .filter(Boolean);

  // ★ ব্যাজটি অ্যাডমিন নিজে লিখেছেন কি না — নিচে (HomePage) এই
  //   তথ্যটিই ঠিক করে ব্যাজে অ্যাডমিনের কথা থাকবে, নাকি সিস্টেমের
  //   মাপা পরিচালন-অবস্থা। অ্যাডমিনের কথা সবসময় জেতে।
  return {
    content,
    highlights,
    adminBadge: Boolean(hc?.badge?.trim()),
  };
}

export default async function HomePage() {
  let banners: any[] = [];
  let settings: Record<string, string> = {};
  // ★ Phase 4 — পণ্য-শোকেসের ডেটা এখন `getShowcase()` থেকে আসে
  //   (showcase.ts): একই সৎ ব্যাজ-যুক্তি (soldOut/discount, 5.11) +
  //   প্রকৃত অর্ডার-উদ্ভূত জনপ্রিয়তা, শুরু-দাম, নতুন-চিহ্ন। read-only
  //   ও নিজে-গার্ডেড — DB সমস্যা হলে খালি ফেরে, throw নয়।
  let showcase: ShowcaseData = { products: [], collections: [], hasSales: false };
  let payMethods: string[] = [];

  try {
    let channels: { method: string }[] = [];
    [banners, settings, showcase, channels] = await Promise.all([
      prisma.banner.findMany({
        where: { isActive: true },
        orderBy: { sortOrder: 'asc' },
        select: { id: true, image: true, title: true, subtitle: true, link: true },
      }),
      getSettings(),
      getShowcase(),
      prisma.paymentChannel.findMany({
        where: { isActive: true },
        orderBy: { sortOrder: 'asc' },
        select: { method: true },
      }),
    ]);
    payMethods = Array.from(new Set(channels.map((c) => c.method)));
  } catch (e) {
    // ★ DB না পেলেও পেজ ভাঙবে না — খালি দেখাবে
    console.error('[home] db unavailable:', e);
  }

  const notice = settings.site_notice;

  // ★ Phase 5 — লাইভ ফিড কতটা, তা settings থেকেই ঠিক হয়
  const liveOn = settings.home_live_activity !== '0';
  const liveCount = Math.min(Math.max(1, parseInt(settings.home_live_activity_count || '8', 10) || 8), 20);

  /**
   * ★★★ পারফরম্যান্স (২০২৬-০৮-০৫ অডিট): একটিই সমান্তরাল ঢেউ।
   *
   *   আগে এগুলো **পরপর** `await` করা হতো — opsStatus → hero →
   *   (popups/slides/notices/floatCards) → deliveries। প্রতিটি ধাপ
   *   দূরবর্তী Neon-এ আলাদা রাউন্ড-ট্রিপ, তাই প্রোডাকশনে হোমপেজের
   *   TTFB মাপা হয়েছিল **৫.৭ সেকেন্ড**, যেখানে বাকি পাতাগুলো ~৭৫০ms।
   *
   *   এগুলোর কেউ একে অপরের ফলাফল ব্যবহার করে না — সবাই কেবল
   *   `settings` চায়, যা উপরের ঢেউয়েই এসে গেছে। তাই একসাথে চালানো
   *   নিরাপদ, আর তাতে ৫টি ধারাবাহিক ঢেউ কমে **২টি** হয়।
   *
   *   ⚠️ প্রতিটি ফাংশন আগের মতোই নিজে-গার্ডেড (ব্যর্থ হলে খালি ফেরে),
   *   তাই `Promise.all` কোনো নতুন ব্যর্থতার পথ তৈরি করে না।
   */
  const [opsStatus, hero, popups, slides, notices, floatCards, deliveries] = await Promise.all([
    getOpsStatus(slaFromSettings(settings)),
    buildHero(settings),
    getPopups(),
    getSlides(),
    getNotices(),
    getFloatingCards(),
    liveOn ? getRecentDeliveries(liveCount) : Promise.resolve([]),
  ]);
  /**
   * ★★★ এক পর্দায় দুটি পরস্পরবিরোধী দাবি — সারানো হলো।
   *
   *   মাপা অবস্থা (২০২৬-০৮-১৮, ডেস্কটপ): ops-ব্যানার বলছে
   *   "ব্যস্ত — ডেলিভারিতে বেশি সময় লাগছে", আর ঠিক ১৫০px নিচে
   *   হিরোর ব্যাজ বলছে "অপারেটর অনলাইন — অর্ডার এলে এখনই যাচাই"।
   *   কারণ ব্যাজটি ছিল একটি **স্থির ধ্রুবক**, আর ব্যানারটি
   *   ডাটাবেস থেকে হিসাব করা।
   *
   *   এখন উৎস একটিই (`getOpsStatus`)। অগ্রাধিকার অপরিবর্তিত ও
   *   অ্যাডমিন-প্রথম: Campaign(HERO)-এর ব্যাজ লেখা থাকলে সেটিই
   *   জেতে (অ্যাডমিন ইচ্ছে করে কিছু বলতে চাইলে সিস্টেম বাধা দেয়
   *   না); নাহলে মাপা অবস্থা; দুটোর একটিও না থাকলে আগের ডিফল্ট।
   */
  if (!hero.adminBadge && opsStatus) hero.content.status = opsStatus.short;

  // ভাসমান যোগাযোগ — মাধ্যম সেট থাকলে ও লিংক নিরাপদ হলে (defense-in-depth)
  const contactType = (settings.float_contact_type || '').trim();
  const contactUrl = settings.float_contact_value ? safeUrl(settings.float_contact_value) : null;

  // ★ শোকেসের সমতল পণ্য-তালিকা → ক্যাটাগরি-ভিত্তিক গ্রিডে গুছিয়ে নেওয়া
  //   (সাজানো ক্রম showcase.ts-এই ধরা — category.sortOrder, তারপর
  //   product.sortOrder)। কোনো পণ্য না থাকা ক্যাটাগরি বাদ।
  const showcaseCats = showcase.collections
    .map((col) => ({
      id: col.id,
      name: col.name,
      icon: col.icon,
      products: showcase.products.filter((p) => p.categoryId === col.id),
    }))
    .filter((c) => c.products.length > 0);

  // ★ ফিচারড রেল — সৎ: প্রকৃত বেস্ট-সেলার (COMPLETED অর্ডার) বা
  //   অ্যাডমিন-চিহ্নিত (Variant.isPopular) প্যাকেজ, কেবল স্টকে-থাকা।
  //   বানানো র‍্যাঙ্কিং নয়; যোগ্য পণ্য না থাকলে খালি → রেল দেখানো হয় না।
  const featured = showcase.products
    .filter((p) => !p.soldOut && (p.orderCount > 0 || p.popular))
    .sort((a, b) => b.orderCount - a.orderCount || Number(b.popular) - Number(a.popular))
    .slice(0, 8);

  // Storefront extras — every link comes from admin settings; blank = hidden.
  const communityUrl = settings.community_url ? safeUrl(settings.community_url) : null;
  const extras: StoreExtras = {
    payMethods,
    community: communityUrl
      ? { url: communityUrl, label: (settings.community_label || '').trim() || 'গ্রুপে যোগ দিন' }
      : null,
    tutorialUrl: settings.tutorial_video_url ? safeUrl(settings.tutorial_video_url) : null,
    appUrl: settings.android_app_url ? safeUrl(settings.android_app_url) : null,
  };

  return (
    <>
      {/* ★ প্রকৃত পরিচালন-অবস্থা — সবার আগে, কারণ এটি সিদ্ধান্তে
          প্রভাব ফেলে (এখন অর্ডার দেব, নাকি পরে?) (2.17) */}
      <OpsStatusBanner status={opsStatus} />

      {/* ── নোটিশ (Phase 3) — অ্যাডমিন Campaign(NOTICE) থাকলে সেগুলো,
          নাহলে site_notice; দুটোই একই এক-লাইন বারে (NoticeBar)।
          কিছুই না থাকলে বার রেন্ডার হয় না — কোনো বানানো নোটিশ নয়। ── */}
      <NoticeBar notices={notices} fallback={notice} />

      {/* ═══ ব্যানার (তিন রেফারেন্সেরই প্রথম জিনিস) — অ্যাডমিন Campaign
          SLIDER; নাহলে Banner; দুটোর একটিও না থাকলে নিচের শেলে হিরো
          ব্যানারের জায়গা নেয় (`showHero`) — জায়গাটি কখনো ফাঁকা থাকে না ═══ */}
      {slides.length > 0 ? (
        <div className="mx-auto max-w-7xl px-4 pt-4 sm:px-6">
          <CampaignSlider slides={slides} />
        </div>
      ) : (banners?.length ?? 0) > 0 ? (
        <div className="mx-auto max-w-7xl px-4 pt-4 sm:px-6">
          <BannerSlider banners={banners} />
        </div>
      ) : null}

      {/* ═══ মূল দোকান — সাপোর্ট-চিপ → জনপ্রিয় → প্রতি ক্যাটাগরি একটি
          সেকশন → সাম্প্রতিক অর্ডার। সব ডেটা উপরে fetch করা, অ্যাডমিন-
          নিয়ন্ত্রিত ও সৎ — shell নিজে কোনো DB call করে না। ═══ */}
      <StorefrontShell
        hero={hero}
        showHero={slides.length === 0 && (banners?.length ?? 0) === 0}
        opsLevel={opsStatus?.level ?? null}
        categories={showcaseCats}
        featured={featured}
        deliveries={deliveries}
        supportHours={settings.support_hours}
        contact={contactType && contactUrl ? { type: contactType, url: contactUrl } : null}
        extras={extras}
      />

      {/* ═══ কিভাবে অর্ডার করবেন · নিয়ম · FAQ ═══ */}
      <StoreHowFaq />

      {/* ═══ অ্যাডমিন-নিয়ন্ত্রিত ওভারলে — Campaign না থাকলে কিছুই রেন্ডার হয় না ═══ */}
      <PopupHost popups={popups} />
      <FloatingCard cards={floatCards} />

      {/* ═══ স্থায়ী যোগাযোগ বোতাম — মাধ্যম ও নিরাপদ লিংক সেট থাকলে ═══ */}
      {contactType && contactUrl && <FloatingContact type={contactType} url={contactUrl} />}
    </>
  );
}
