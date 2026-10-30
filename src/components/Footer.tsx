import Link from 'next/link';
import { cookies } from 'next/headers';
import { prisma } from '@/lib/prisma';
import { getSettings } from '@/lib/settings';
import { SocialIcon, SOCIAL_META } from './SocialIcons';
import VoltMark from '@/components/fx/VoltMark';
import BrandLogo from '@/components/brand/BrandLogo';
import { resolveBranding } from '@/lib/branding';
import { LOCALE_COOKIE, normalizeLocale, translate } from '@/lib/i18n';

/**
 * ═══════════════════════════════════════════════════════════
 * ★ ARC FOOTER (Phase A)
 *
 *   ⚠️ ডেটা স্তর অপরিবর্তিত — একই দুটি query, একই try/catch,
 *   DB না পেলেও ফুটার রেন্ডার হয়।
 *
 *   দুটি বিষয় ঠিক করা হলো:
 *   ১. **💎 ইমোজি সরানো** — ব্র্যান্ড চিহ্ন এখন `VoltMark`।
 *      ইমোজি প্রতিটি প্ল্যাটফর্মে ভিন্ন দেখায়, অর্থাৎ লোগোর
 *      উপর কোনো নিয়ন্ত্রণ থাকে না (CLAUDE.md §7)।
 *   ২. **“২৪/৭ সাপোর্ট” দাবিটি সরানো** — এটি মিথ্যা ছিল।
 *      প্রকৃত সময় সেটিংসে ৯টা–১১টা, আর সেই প্রকৃত সময়টিই
 *      এখন সাপোর্ট কলামে দেখানো হয়। এই কোডবেস আগেই হিরো
 *      থেকে একই মিথ্যা দাবি সরিয়েছিল (trustMetrics.ts) —
 *      ফুটারে সেটি রয়ে গিয়েছিল।
 * ═══════════════════════════════════════════════════════════
 */
export default async function Footer() {
  let socials: { id: number; platform: string; url: string; label: string | null }[] = [];
  let settings: Record<string, string> = {};

  try {
    [socials, settings] = await Promise.all([
      prisma.socialLink.findMany({
        where: { isActive: true },
        orderBy: { sortOrder: 'asc' },
        select: { id: true, platform: true, url: true, label: true },
      }),
      getSettings(),
    ]);
  } catch { /* DB fail হলেও footer render হবে */ }

  const brand = resolveBranding(settings ?? {});
  const siteName = brand.siteName;

  // ★ ফিচার ১০ — কুকি থেকে ভাষা (সার্ভার কম্পোনেন্ট, তাই translate() সরাসরি)
  const locale = normalizeLocale(cookies().get(LOCALE_COOKIE)?.value);
  const t = (k: string) => translate(locale, k);

  const COLS: { head: string; links: { href: string; label: string; prefetch?: boolean }[] }[] = [
    {
      head: t('footer.product'),
      links: [
        { href: '/', label: t('home.allProducts') },
        { href: '/track', label: t('nav.track') },
        { href: '/account/orders', label: t('nav.orders'), prefetch: false },
        { href: '/account/wallet/deposit', label: t('nav.wallet'), prefetch: false },
      ],
    },
    {
      head: t('footer.support'),
      links: [
        { href: '/faq', label: t('nav.faq') },
        { href: '/contact', label: t('nav.contact') },
        { href: '/refund', label: t('footer.refund') },
        { href: '/tutorial', label: 'টিউটোরিয়াল' },
        { href: '/about', label: 'আমাদের সম্পর্কে' },
        { href: '/developers', label: 'Reseller API' },
      ],
    },
    {
      head: t('footer.info'),
      links: [
        { href: '/terms', label: t('footer.terms') },
        { href: '/privacy', label: t('footer.privacy') },
        { href: '/delete-account', label: 'অ্যাকাউন্ট মোছার নীতি' },
      ],
    },
  ];

  return (
    <footer className="relative mt-4 overflow-hidden" style={{ borderTop: '1px solid var(--v-edge)' }}>
      <div aria-hidden="true" className="v-flow-line absolute inset-x-0 top-0 h-px" />
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-x-0 top-0 h-72"
        style={{ background: 'radial-gradient(ellipse 60% 100% at 50% 0, rgba(109,40,217,.05), transparent 70%)' }}
      />

      <div className="relative mx-auto max-w-7xl px-4 pb-10 pt-14 sm:px-6">
        {/**
          * ═══ ফুটার গ্রিড ═══
          *
          * ⚠️⚠️ আগে `grid gap-10 lg:grid-cols-12` — অর্থাৎ ১০২৪px-এর
          *   নিচে **একটিই কলাম**, প্রতিটি ব্লকের মাঝে ৪০px ফাঁক।
          *   ফলে ফোনে ফুটারটি ১০টি লিংক + সাপোর্ট-ব্লক মিলিয়ে
          *   **~১৫০০px লম্বা** হয়ে যেত (৩৯০px-এ মাপা: লিংকগুলো
          *   y ৫৭৯৭ থেকে ৬৩৯৩)। ব্যবহারকারী শর্তাবলী খুঁজতে গিয়ে
          *   দুই পর্দা স্ক্রল করতেন।
          *
          *   এখন ফোনে **২×২ গ্রিড** — চারটি ব্লক (প্রোডাক্ট · সহায়তা ·
          *   তথ্য · সাপোর্ট) ঠিক দুই সারিতে বসে, তাই একটিও ফাঁকা ঘর
          *   থাকে না। ব্র্যান্ড-ব্লক পুরো প্রস্থে, কারণ তাতে বর্ণনা ও
          *   সোশ্যাল আইকন আছে।
          */}
        <div className="grid grid-cols-2 gap-x-4 gap-y-9 lg:grid-cols-12 lg:gap-10">
          {/* ═══ ব্র্যান্ড ═══ */}
          <div className="col-span-2 lg:col-span-4">
            <div className="flex items-center gap-3">
              {/* ★ অ্যাডমিনের সেকেন্ডারি লোগো থাকলে সেটিই (থিম-সচেতন),
                  নাহলে বিদ্যমান VoltMark + নাম */}
              {brand.logos.secondary.dark || brand.logos.secondary.light ? (
                <BrandLogo logos={brand.logos.secondary} slot="secondary" alt={siteName} height={44} />
              ) : (
                <>
                  <VoltMark size={44} uid="foot" />
                  <div>
                    <p
                      className="v-dsp text-lg font-extrabold uppercase leading-none"
                      style={{ color: 'var(--v-ink)', letterSpacing: '-.02em' }}
                    >
                      {siteName}
                    </p>
                    <p className="hud hud-wide mt-1.5">GAME&nbsp;TOP-UP&nbsp;·&nbsp;BD</p>
                  </div>
                </>
              )}
            </div>

            <p className="mt-5 max-w-sm text-sm leading-[1.85]" style={{ color: 'var(--v-mut)' }}>
              ফ্রি ফায়ার ডায়মন্ড ও সাবস্ক্রিপশন টপ-আপ। প্রতিটি পেমেন্ট একজন মানুষ
              যাচাই করে, আর ডেলিভারি না হলে পুরো টাকা ওয়ালেটে ফেরত যায়।
            </p>

            {(socials?.length ?? 0) > 0 && (
              <div className="mt-6 flex flex-wrap gap-2">
                {(socials ?? []).map((s: (typeof socials)[number]) => {
                  const meta = SOCIAL_META[s.platform];
                  return (
                    <a
                      key={s.id} href={s.url} target="_blank" rel="noopener noreferrer nofollow"
                      aria-label={s.label || meta?.label || s.platform}
                      title={s.label || meta?.label || s.platform}
                      className="grid h-11 w-11 place-items-center transition-all duration-300 hover:-translate-y-1"
                      style={{ border: '1px solid var(--v-edge)', background: 'var(--v-void)', color: 'var(--v-mut)' }}
                    >
                      <SocialIcon platform={s.platform} />
                    </a>
                  );
                })}
              </div>
            )}
          </div>

          {/* ═══ লিংক কলাম ═══ */}
          {COLS.map((col) => (
            <div key={col.head} className="lg:col-span-2">
              <h2 className="hud">{col.head}</h2>
              <ul className="mt-4 space-y-0.5">
                {col.links.map((l) => (
                  <li key={l.href}>
                    {/* ★ prefetch={false} লগইন-সুরক্ষিত রুটে (Phase 6):
                        অতিথির জন্য প্রি-ফেচ 307 এ গিয়ে ব্যর্থ হতো এবং
                        প্রতিটি পাবলিক পাতায় কনসোল ত্রুটি ফেলত। */}
                    <Link href={l.href} prefetch={l.prefetch} className="fnav">{l.label}</Link>
                  </li>
                ))}
              </ul>
            </div>
          ))}

          {/* ═══ সাপোর্ট ═══ */}
          <div className="lg:col-span-2">
            <h2 className="hud">সাপোর্ট</h2>
            <ul className="mt-4 space-y-3 text-sm" style={{ color: 'var(--v-mut)' }}>
              {settings?.support_email && (
                <li className="leading-snug">
                  <span className="hud-mut hud block">ইমেইল</span>
                  {/* ⚠️ `break-all` — ইমেইলে ফাঁকা জায়গা নেই, তাই সাধারণ
                    wrap কাজ করে না। মোবাইলের অর্ধেক কলামে (৩২০px-এ
                    ১৩৬px) একটি লম্বা ঠিকানা নাহলে কলামের বাইরে বেরিয়ে
                    যেত। */}
                <a href={`mailto:${settings.support_email}`} className="fnav break-all">{settings.support_email}</a>
                </li>
              )}
              {settings?.support_phone && (
                <li className="leading-snug">
                  <span className="hud-mut hud block">ফোন</span>
                  <span className="v-hud" style={{ color: 'var(--v-ink)' }}>{settings.support_phone}</span>
                </li>
              )}
              {settings?.support_hours && (
                <li className="leading-snug">
                  <span className="hud-mut hud block">খোলা থাকে</span>
                  <span className="v-hud" style={{ color: 'var(--v-ink)' }}>{settings.support_hours}</span>
                </li>
              )}
            </ul>
            <p className="mt-4 text-xs leading-relaxed" style={{ color: 'var(--v-dim)' }}>
              সমস্যা হলে TrxID ও স্ক্রিনশট সহ মেসেজ দিন — অনেক দ্রুত সমাধান হয়।
            </p>
          </div>
        </div>

        {/* ═══ নিচের স্ট্রিপ ═══ */}
        <div
          className="mt-12 flex flex-col gap-3 pt-6 text-xs sm:flex-row sm:items-center sm:justify-between"
          style={{ borderTop: '1px solid var(--v-edge)', color: 'var(--v-dim)' }}
        >
          {/* ★ অ্যাডমিন কপিরাইট-লাইন লিখে দিলে সেটিই; নাহলে অনুবাদ-ভিত্তিক
              স্বয়ংক্রিয় লাইন (ভাষা বদলালেও ঠিক থাকে) */}
          <p>
            {settings?.brand_copyright?.trim()
              || `© ${new Date().getFullYear()} ${brand.company}. ${t('footer.rights')}।`}
          </p>
          {brand.footerText
            ? <p>{brand.footerText}</p>
            : <p>১৮ বছরের নিচে অভিভাবকের অনুমতি ছাড়া অর্ডার নিষিদ্ধ।</p>}
        </div>
      </div>

      {/* ═══ বিশাল ব্র্যান্ড-শব্দচিহ্ন ═══
          বড় ব্র্যান্ডের ফুটারে থাকা সেই বিশাল, প্রায়-অদৃশ্য নামটি।
          খাঁটি সাজসজ্জা, তাই `aria-hidden` — স্ক্রিন রিডারে সাইটের
          নাম দ্বিতীয়বার পড়ার কোনো মানে নেই। */}
      <div
        aria-hidden="true"
        className="v-dsp pointer-events-none select-none whitespace-nowrap text-center font-extrabold uppercase leading-[.8]"
        style={{
          fontSize: 'clamp(3.5rem, 15vw, 12rem)',
          letterSpacing: '-.05em',
          background: 'linear-gradient(180deg, rgba(15,23,41,.06), transparent 78%)',
          WebkitBackgroundClip: 'text',
          backgroundClip: 'text',
          color: 'transparent',
          marginBottom: '-.18em',
        }}
      >
        {siteName}
      </div>
    </footer>
  );
}
