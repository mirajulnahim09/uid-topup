import { prisma } from '@/lib/prisma';
import { getSettings } from '@/lib/settings';
import BannerSlider from '@/components/BannerSlider';
import StorefrontShell, { type HeroContent } from '@/components/home/StorefrontShell';
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
 *   ─── পাতার গল্পরেখা ───
 *     অবস্থা → হুক (হিরো) → সংকেত → **কে কাজটা করে**
 *     → কী কিনবেন → ঝুঁকি কার → শেষ ধাক্কা
 *
 *   প্রতিটি সেকশনের জ্যামিতি আলাদা — পূর্ণ-পর্দা হিরো, কাত
 *   দ্বিমুখী টিকার, আঠালো টার্মিনাল + স্ক্রল-চালিত ধাপ, ট্যাব
 *   করা গ্রিড, ভাঙা বেন্টো, কেন্দ্রীভূত প্যানেল। একই কার্ড-সারি
 *   বারবার এলে পাতাটা টেমপ্লেটের মতো লাগত।
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

// ★ ডিফল্ট — সৎ, প্রিমিয়াম, বাংলাদেশ-কেন্দ্রিক (কোনো অযাচাইযোগ্য দাবি নয়)
const DEFAULT_STATUS = 'অপারেটর অনলাইন — অর্ডার এলে এখনই যাচাই';
const DEFAULT_TITLE = 'গেমে ফেরার\nদ্রুততম রাস্তা';
const DEFAULT_SUBTITLE =
  'bKash-এ টাকা পাঠান — একজন মানুষ নিজে মিলিয়ে দেখে সেকেন্ডেই আপনার UID-তে ইনভেন্টরি ভরে দেয়।';
const DEFAULT_CTA = 'টপ-আপ শুরু করুন';
const DEFAULT_HIGHLIGHTS = [
  'মানুষ নিজে যাচাই করে',
  'না পেলে ১০০% ফেরত',
  'প্রতিটি ধাপ লাইভ',
  'bKash · Nagad · Rocket',
];

function settingOrNull(v: string | undefined, seed: string): string | null {
  const t = (v || '').trim();
  return !t || t === seed ? null : t;
}

async function buildHero(settings: Record<string, string>): Promise<{ content: HeroContent; highlights: string[] }> {
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

  return { content, highlights: highlights.length ? highlights : DEFAULT_HIGHLIGHTS };
}

export default async function HomePage() {
  let banners: any[] = [];
  let settings: Record<string, string> = {};
  // ★ Phase 4 — পণ্য-শোকেসের ডেটা এখন `getShowcase()` থেকে আসে
  //   (showcase.ts): একই সৎ ব্যাজ-যুক্তি (soldOut/discount, 5.11) +
  //   প্রকৃত অর্ডার-উদ্ভূত জনপ্রিয়তা, শুরু-দাম, নতুন-চিহ্ন। read-only
  //   ও নিজে-গার্ডেড — DB সমস্যা হলে খালি ফেরে, throw নয়।
  let showcase: ShowcaseData = { products: [], collections: [], hasSales: false };

  try {
    [banners, settings, showcase] = await Promise.all([
      prisma.banner.findMany({
        where: { isActive: true },
        orderBy: { sortOrder: 'asc' },
        select: { id: true, image: true, title: true, subtitle: true, link: true },
      }),
      getSettings(),
      getShowcase(),
    ]);
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

  return (
    <>
      {/* ★ প্রকৃত পরিচালন-অবস্থা — সবার আগে, কারণ এটি সিদ্ধান্তে
          প্রভাব ফেলে (এখন অর্ডার দেব, নাকি পরে?) (2.17) */}
      <OpsStatusBanner status={opsStatus} />

      {/* ── নোটিশ (Phase 3) — অ্যাডমিন Campaign(NOTICE) থাকলে চলমান
          বার/ব্রেকিং নিউজ; নাহলে বিদ্যমান site_notice স্ট্যাটিক বার
          (দুটোই অ্যাডমিন-নিয়ন্ত্রিত, কিছু হার্ডকোড নয়) ── */}
      {notices.length > 0 ? (
        <NoticeBar notices={notices} />
      ) : notice ? (
        <div
          style={{
            borderBottom: '1px solid #dcefc4',
            background: 'linear-gradient(90deg, #f2fbe6, #fbfef5)',
          }}
        >
          <div className="mx-auto flex max-w-7xl items-center gap-3 px-4 py-2.5 sm:px-6">
            <span className="hud shrink-0" style={{ color: '#4d7c0f' }}>নোটিশ</span>
            <span className="hidden h-3 w-px shrink-0 sm:block" style={{ background: '#c3e393' }} aria-hidden="true" />
            <p className="text-xs leading-relaxed sm:text-[13px]" style={{ color: '#3f6212' }}>{notice}</p>
          </div>
        </div>
      ) : null}

      {/* ═══ ব্যানার স্লাইডার (অ্যাডমিন Campaign SLIDER; নাহলে Banner) ═══ */}
      {slides.length > 0 ? (
        <div className="mx-auto max-w-7xl px-4 pt-5 sm:px-6">
          <CampaignSlider slides={slides} />
        </div>
      ) : (banners?.length ?? 0) > 0 ? (
        <div className="mx-auto max-w-7xl px-4 pt-5 sm:px-6">
          <BannerSlider banners={banners} />
        </div>
      ) : null}

      {/* ═══ মূল দোকান — reference-শৈলীর ৩-কলাম শেল
          (সাইডবার + গ্রিড + লাইভ ফিড)। সব ডেটা উপরে fetch করা,
          admin-নিয়ন্ত্রিত ও সৎ — shell নিজে কোনো DB call করে না। ═══ */}
      <StorefrontShell
        hero={hero}
        categories={showcaseCats}
        featured={featured}
        deliveries={deliveries}
        supportHours={settings.support_hours}
      />

      {/* ═══ কিভাবে অর্ডার করবেন · নিয়ম · FAQ · CTA ═══ */}
      <StoreHowFaq />

      {/* ═══ অ্যাডমিন-নিয়ন্ত্রিত ওভারলে — Campaign না থাকলে কিছুই রেন্ডার হয় না ═══ */}
      <PopupHost popups={popups} />
      <FloatingCard cards={floatCards} />

      {/* ═══ স্থায়ী যোগাযোগ বোতাম — মাধ্যম ও নিরাপদ লিংক সেট থাকলে ═══ */}
      {contactType && contactUrl && <FloatingContact type={contactType} url={contactUrl} />}
    </>
  );
}
