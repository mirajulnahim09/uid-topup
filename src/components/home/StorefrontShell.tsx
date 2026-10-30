'use client';

import Link from 'next/link';
import { useEffect, useRef } from 'react';
import { useT } from '@/components/i18n/I18nProvider';
import ProductImage from '@/components/fx/ProductImage';
import { SocialIcon, SOCIAL_META } from '@/components/SocialIcons';

/** Hero content — admin-controlled, built in page.tsx */
export type HeroContent = {
  status: string;
  title: string;      // '\n' splits lines
  subtitle: string;
  ctaLabel: string;
  ctaLink: string;
  imageUrl: string | null;
};

/**
 * ═══════════════════════════════════════════════════════════
 * STOREFRONT — premium layout (2026-10-31)
 *
 *   Built on the three-reference blueprint (`3_REFERENCE_COMBINED_BLUEPRINT.md`):
 *   banner → support → one section per category → live orders. On top of
 *   that grammar, the best ideas from each reference:
 *     · uidtopup.com  — category anchors, Bangla QR / wallet / instant pay
 *     · topupbuzz.com — support + group chips, Tutorial, Recent Orders card
 *     · fristtopup.com — wide multi-game catalogue, community link
 *   and what none of them do: starting price on every tile, a category
 *   rail, and a payment band built from the admin's real channels.
 *
 *   Data only — no DB calls here. Nothing is invented: every number,
 *   badge and link comes from page.tsx (showcase, settings, channels);
 *   a block with no data is not rendered.
 * ═══════════════════════════════════════════════════════════
 */

type SCat = {
  id: number;
  name: string;
  icon: string | null;
  products: SProduct[];
};
type SProduct = {
  id: number;
  name: string;
  slug: string;
  image: string | null;
  categoryId: number;
  soldOut: boolean;
  discountPct: number;
  startingPrice: number | null;
  popular: boolean;
  isNew: boolean;
  orderCount: number;
};
type Delivery = {
  id: string;
  name: string;
  productName: string;
  variantName: string;
  at: string;
};

export type StoreExtras = {
  /** distinct active payment methods (from PaymentChannel) */
  payMethods: string[];
  community: { url: string; label: string } | null;
  tutorialUrl: string | null;
  appUrl: string | null;
};

const bdt = (n: number) =>
  '৳' + n.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 2 });

// Fallback tones for tiles without an uploaded image (per category order)
const PALETTE = [
  { g1: '#8b5cf6', g2: '#4c1d95' },
  { g1: '#f59e0b', g2: '#b45309' },
  { g1: '#06b6d4', g2: '#0e4f73' },
  { g1: '#ec4899', g2: '#9d174d' },
  { g1: '#22c55e', g2: '#166534' },
  { g1: '#6366f1', g2: '#312e81' },
];
const pal = (i: number) => PALETTE[i % PALETTE.length];

const PAY_LABEL: Record<string, string> = {
  BKASH: 'bKash', NAGAD: 'Nagad', ROCKET: 'Rocket', UPAY: 'Upay', BANGLA_QR: 'Bangla QR',
};
const PAY_COLOR: Record<string, string> = {
  BKASH: '#E2136E', NAGAD: '#EE1C25', ROCKET: '#8C3494', UPAY: '#F58220', BANGLA_QR: '#0E7C66',
};

/**
 * "time ago" can cross a minute boundary between SSR and hydration, so the
 * span that holds it uses suppressHydrationWarning (only that text).
 */
function timeAgo(iso: string): string {
  const s = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return 'এইমাত্র';
  const m = Math.floor(s / 60);
  if (m < 60) return `${m} মিনিট আগে`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h} ঘণ্টা আগে`;
  return `${Math.floor(h / 24)} দিন আগে`;
}

/**
 * Scroll reveal. Only elements that start BELOW the fold are hidden and
 * then faded in, so nothing above the fold ever flashes, and without JS
 * (or with reduced motion) everything is simply visible.
 */
function useReveal() {
  const root = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = root.current;
    if (!el || typeof IntersectionObserver === 'undefined') return;
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const items = Array.from(el.querySelectorAll<HTMLElement>('.sf-rv'));
    const fold = window.innerHeight * 0.95;
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (e.isIntersecting) {
            (e.target as HTMLElement).removeAttribute('data-rv');
            io.unobserve(e.target);
          }
        }
      },
      { rootMargin: '0px 0px -8% 0px', threshold: 0.08 },
    );
    for (const it of items) {
      if (it.getBoundingClientRect().top > fold) {
        it.setAttribute('data-rv', 'wait');
        io.observe(it);
      }
    }
    return () => io.disconnect();
  }, []);
  return root;
}

const GRID = 'grid grid-cols-3 gap-2.5 sm:grid-cols-4 sm:gap-3.5 lg:grid-cols-5 xl:grid-cols-6';

export default function StorefrontShell({
  hero,
  showHero,
  opsLevel,
  categories,
  featured,
  deliveries,
  supportHours,
  contact,
  extras,
}: {
  hero: { content: HeroContent; highlights: string[] };
  /** hero takes the banner slot only when there is no slider/banner */
  showHero: boolean;
  opsLevel?: 'open' | 'busy' | 'closed' | null;
  categories: SCat[];
  featured: SProduct[];
  deliveries: Delivery[];
  supportHours?: string;
  contact: { type: string; url: string } | null;
  extras: StoreExtras;
}) {
  const t = useT();
  const catIndex = (id: number) => Math.max(0, categories.findIndex((c) => c.id === id));
  const firstCat = categories[0] ? `#cat-${categories[0].id}` : '#catalog';
  const root = useReveal();

  return (
    <div ref={root} className="mx-auto max-w-7xl px-4 pb-8 pt-4 sm:px-6 sm:pt-5">
      {showHero && (
        <StoreHero hero={hero} opsLevel={opsLevel ?? null} fallbackLink={firstCat} payMethods={extras.payMethods} />
      )}

      {categories.length > 1 && <CategoryRail categories={categories} />}

      <QuickActions contact={contact} supportHours={supportHours} community={extras.community} />

      {/* `catalog` keeps the old `/#catalog` links working */}
      <div id="catalog" className="scroll-mt-24" />

      {/* Popular — only with real sales or admin-marked packages, at least 3 */}
      {featured.length >= 3 && (
        <Section id="popular" title={t('home.popular')} kicker="সবচেয়ে বেশি অর্ডার" count={Math.min(6, featured.length)}>
          <div className={GRID}>
            {featured.slice(0, 6).map((p, i) => (
              <ProductTile key={p.id} p={p} tone={pal(catIndex(p.categoryId) + i)} i={i} />
            ))}
          </div>
        </Section>
      )}

      {/* One section per category — `cat-<id>` is the Navbar/rail anchor */}
      {categories.map((c) => (
        <Section key={c.id} id={`cat-${c.id}`} title={c.name} count={c.products.length}>
          <div className={GRID}>
            {c.products.map((p, i) => (
              <ProductTile key={p.id} p={p} tone={pal(catIndex(c.id) + i)} i={i} />
            ))}
          </div>
        </Section>
      ))}

      {categories.length === 0 && (
        <div className="sf-card mt-8 px-6 py-14 text-center">
          <p className="text-sm" style={{ color: 'var(--v-mut)' }}>এই মুহূর্তে কোনো প্রোডাক্ট নেই।</p>
        </div>
      )}

      {deliveries.length > 0 && <LiveOrders deliveries={deliveries} />}

      <PayBand methods={extras.payMethods} tutorialUrl={extras.tutorialUrl} />

      {extras.appUrl && <AppBanner url={extras.appUrl} />}
    </div>
  );
}

/* ─────────── pieces ─────────── */

function Section({
  id, title, kicker, count, children,
}: { id: string; title: string; kicker?: string; count?: number; children: React.ReactNode }) {
  return (
    <section id={id} className="mt-10 scroll-mt-24 sm:mt-14" aria-labelledby={`${id}-h`}>
      <div className="sf-rv mb-4 flex items-end justify-between gap-3 sm:mb-5">
        <div className="min-w-0">
          {kicker && <p className="sf-kicker">{kicker}</p>}
          <h2 id={`${id}-h`} className="sf-sec-title">
            <span className="sf-sec-bar" aria-hidden="true" />
            <span className="truncate">{title}</span>
          </h2>
        </div>
        {typeof count === 'number' && count > 0 && (
          <span className="sf-count">{count}টি প্রোডাক্ট</span>
        )}
      </div>
      {children}
    </section>
  );
}

function CategoryRail({ categories }: { categories: SCat[] }) {
  return (
    <nav aria-label="ক্যাটাগরি" className="sf-rail -mx-4 mt-4 px-4 sm:mx-0 sm:px-0">
      <ul className="flex gap-2 overflow-x-auto pb-1">
        {categories.map((c, i) => (
          <li key={c.id} className="shrink-0">
            <a href={`#cat-${c.id}`} className="sf-chip">
              <span className="sf-chip-dot" style={{ background: `linear-gradient(135deg,${pal(i).g1},${pal(i).g2})` }} aria-hidden="true">
                {c.icon && /\p{Extended_Pictographic}/u.test(c.icon) ? c.icon : c.name.trim().charAt(0)}
              </span>
              <span className="whitespace-nowrap">{c.name}</span>
              <span className="sf-chip-n">{c.products.length}</span>
            </a>
          </li>
        ))}
      </ul>
    </nav>
  );
}

function QuickActions({
  contact, supportHours, community,
}: {
  contact: { type: string; url: string } | null;
  supportHours?: string;
  community: { url: string; label: string } | null;
}) {
  const meta = contact ? SOCIAL_META[contact.type] : null;
  const items: { key: string; href: string; external: boolean; kicker: string; label: string; icon: React.ReactNode; tint: string }[] = [];

  if (contact && meta) {
    items.push({
      key: 'support', href: contact.url, external: true,
      kicker: supportHours ? `সাপোর্ট · ${supportHours}` : 'সাপোর্ট',
      label: meta.label,
      icon: <SocialIcon platform={contact.type} size={20} />,
      tint: contact.type === 'whatsapp' ? '#25D366' : contact.type === 'telegram' ? '#26A5E4' : '#3b82f6',
    });
  }
  if (community) {
    items.push({
      key: 'community', href: community.url, external: true,
      kicker: 'কমিউনিটি', label: community.label,
      icon: (
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2" /><circle cx="9" cy="7" r="4" /><path d="M23 21v-2a4 4 0 00-3-3.87M16 3.13a4 4 0 010 7.75" />
        </svg>
      ),
      tint: '#8b5cf6',
    });
  }
  items.push({
    key: 'tutorial', href: '/tutorial', external: false,
    kicker: 'নতুন?', label: 'কিভাবে অর্ডার করবেন',
    icon: (
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <circle cx="12" cy="12" r="10" /><path d="M10 8l6 4-6 4V8z" fill="currentColor" stroke="none" />
      </svg>
    ),
    tint: '#ef4444',
  });
  items.push({
    key: 'track', href: '/track', external: false,
    kicker: 'অর্ডার', label: 'ট্র্যাক করুন',
    icon: (
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <circle cx="11" cy="11" r="7" /><path d="M21 21l-4.3-4.3" />
      </svg>
    ),
    tint: '#0ea5e9',
  });
  if (!contact || !meta) {
    items.unshift({
      key: 'contact', href: '/contact', external: false,
      kicker: 'সাহায্য লাগবে?', label: 'যোগাযোগ করুন',
      icon: (
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z" />
        </svg>
      ),
      tint: '#8b5cf6',
    });
  }

  return (
    <div className="mt-4 grid grid-cols-2 gap-2.5 sm:mt-5 sm:gap-3 lg:grid-cols-4">
      {items.slice(0, 4).map((it) => {
        const inner = (
          <>
            <span className="sf-qa-icon" style={{ color: it.tint, background: `color-mix(in srgb, ${it.tint} 14%, transparent)` }}>
              {it.icon}
            </span>
            <span className="min-w-0 leading-tight">
              <span className="sf-qa-kicker">{it.kicker}</span>
              <span className="sf-qa-label">{it.label}</span>
            </span>
            <svg className="sf-qa-arrow" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" aria-hidden="true"><path d="M9 6l6 6-6 6" /></svg>
          </>
        );
        return it.external ? (
          <a key={it.key} href={it.href} target="_blank" rel="noopener noreferrer" className="sf-qa">{inner}</a>
        ) : (
          <Link key={it.key} href={it.href} className="sf-qa">{inner}</Link>
        );
      })}
    </div>
  );
}

function LiveOrders({ deliveries }: { deliveries: Delivery[] }) {
  const t = useT();
  return (
    <section id="live-orders" className="mt-12 sm:mt-16" aria-labelledby="live-orders-h">
      <div className="sf-card sf-rv overflow-hidden">
        <div className="flex items-center justify-between gap-3 px-4 py-4 sm:px-6" style={{ borderBottom: '1px solid var(--v-edge)' }}>
          <div className="flex items-center gap-3">
            <span className="sf-live-orb" aria-hidden="true" />
            <div>
              <h2 id="live-orders-h" className="text-[16px] font-extrabold sm:text-[18px]" style={{ color: 'var(--v-ink)' }}>{t('home.latestOrders')}</h2>
              <p className="text-[12px]" style={{ color: 'var(--v-mut)' }}>সর্বশেষ সম্পন্ন অর্ডারগুলো — নাম গোপন রাখা</p>
            </div>
          </div>
          <span className="sf-live-pill">
            <span className="v-blink inline-block h-1.5 w-1.5 rounded-full" style={{ background: 'currentColor' }} aria-hidden="true" />
            Live
          </span>
        </div>
        {/* grid-cols-1 (minmax(0,1fr)) is required so `truncate` works on phones */}
        <ul className="grid grid-cols-1 md:grid-cols-2">
          {deliveries.slice(0, 8).map((d, i) => {
            const c = pal(i);
            return (
              <li key={d.id} className="flex items-center gap-3 px-4 py-3 sm:px-6" style={{ borderBottom: '1px solid var(--hairline)' }}>
                <span className="grid h-10 w-10 shrink-0 place-items-center rounded-2xl text-[15px] font-extrabold text-white"
                  style={{ background: `linear-gradient(135deg,${c.g1},${c.g2})` }} aria-hidden="true">
                  {d.name.trim().charAt(0) || 'U'}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[13.5px] font-bold" style={{ color: 'var(--v-ink)' }}>{d.name}</span>
                  <span className="block truncate text-[12px]" style={{ color: 'var(--v-mut)' }}>
                    {d.productName}{d.variantName ? ` · ${d.variantName}` : ''}
                  </span>
                </span>
                <span className="shrink-0 text-right">
                  <span className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-extrabold"
                    style={{ background: 'var(--sem-success-tint)', color: 'var(--sem-success)' }}>
                    <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" aria-hidden="true"><path d="M20 6L9 17l-5-5" /></svg>
                    {t('home.completed')}
                  </span>
                  <span suppressHydrationWarning className="mt-0.5 block whitespace-nowrap text-[10.5px]" style={{ color: 'var(--v-dim)' }}>{timeAgo(d.at)}</span>
                </span>
              </li>
            );
          })}
        </ul>
      </div>
    </section>
  );
}

function PayBand({ methods, tutorialUrl }: { methods: string[]; tutorialUrl: string | null }) {
  /**
   * Facts here are existing, verifiable features of this site (order
   * timeline, wallet refund on cancel — see /refund, support tickets),
   * not marketing claims.
   */
  const facts = [
    { h: 'ধাপে ধাপে অর্ডার-অবস্থা', p: 'প্রতিটি অর্ডারের প্রতিটি ধাপ অ্যাকাউন্টে দেখুন' },
    { h: 'বাতিল হলে ওয়ালেটে ফেরত', p: 'ডেলিভারি না হলে টাকা ওয়ালেটে ফিরে আসে' },
    { h: 'সাপোর্ট টিকিট', p: 'অর্ডার নিয়ে সমস্যা হলে সরাসরি টিকিট খুলুন' },
  ];
  return (
    <section className="sf-band sf-rv mt-12 sm:mt-16" aria-labelledby="pay-band-h">
      <div className="grid gap-6 lg:grid-cols-[1.1fr_1fr] lg:items-center">
        <div>
          <p className="sf-kicker" style={{ color: 'var(--hero-accent)' }}>পেমেন্ট</p>
          <h2 id="pay-band-h" className="mt-1 text-[22px] font-extrabold leading-tight text-white sm:text-[28px]" style={{ letterSpacing: '-.02em' }}>
            আপনার পছন্দের মাধ্যমে পেমেন্ট করুন
          </h2>
          {methods.length > 0 && (
            <ul className="mt-4 flex flex-wrap gap-2">
              {methods.map((m) => (
                <li key={m} className="sf-pay-chip">
                  <span className="h-2.5 w-2.5 rounded-full" style={{ background: PAY_COLOR[m] ?? '#fff' }} aria-hidden="true" />
                  {PAY_LABEL[m] ?? m}
                </li>
              ))}
              <li className="sf-pay-chip">
                <span className="h-2.5 w-2.5 rounded-full" style={{ background: 'var(--hero-accent)' }} aria-hidden="true" />
                ওয়ালেট
              </li>
            </ul>
          )}
          <div className="mt-5 flex flex-wrap gap-3">
            <Link href="/tutorial" className="sf-band-btn">কিভাবে অর্ডার করবেন</Link>
            {tutorialUrl && (
              <a href={tutorialUrl} target="_blank" rel="noopener noreferrer" className="sf-band-btn sf-band-btn--ghost">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M8 5v14l11-7z" /></svg>
                ভিডিও দেখুন
              </a>
            )}
          </div>
        </div>
        <ul className="grid gap-2.5">
          {facts.map((f, i) => (
            <li key={f.h} className="sf-fact">
              <span className="sf-fact-n">{['০১', '০২', '০৩'][i]}</span>
              <span>
                <span className="block text-[14px] font-bold text-white">{f.h}</span>
                <span className="block text-[12.5px]" style={{ color: 'rgba(255,255,255,.72)' }}>{f.p}</span>
              </span>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}

function AppBanner({ url }: { url: string }) {
  return (
    <a href={url} target="_blank" rel="noopener noreferrer" className="sf-card sf-app sf-rv mt-5 flex items-center gap-4 p-4 sm:p-5">
      <span className="grid h-12 w-12 shrink-0 place-items-center rounded-2xl" style={{ background: 'linear-gradient(135deg,#22c55e,#15803d)', color: '#fff' }} aria-hidden="true">
        <svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor"><path d="M3.6 2.2a1 1 0 00-.6.9v17.8a1 1 0 00.6.9l9.7-9.8zM14.7 13.4l2.6 2.6-11.1 6.3zM14.7 10.6L6.2 1.7l11.1 6.3zM18.6 8.8l3 1.7a1.6 1.6 0 010 2.9l-3 1.7-2.9-3.1z" /></svg>
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-[15px] font-extrabold" style={{ color: 'var(--v-ink)' }}>Android অ্যাপ ডাউনলোড করুন</span>
        <span className="block text-[12.5px]" style={{ color: 'var(--v-mut)' }}>Google Play থেকে ইনস্টল করে আরও দ্রুত অর্ডার করুন</span>
      </span>
      <span className="sf-band-btn hidden sm:inline-flex" style={{ background: 'var(--accent)', color: 'var(--accent-ink)' }}>ইনস্টল</span>
    </a>
  );
}

function GemArt() {
  // Original decorative illustration: faceted gems (no brand assets).
  return (
    <svg viewBox="0 0 220 200" className="h-full w-full" aria-hidden="true">
      <defs>
        <linearGradient id="gA" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stopColor="#e9d5ff" /><stop offset=".5" stopColor="#a78bfa" /><stop offset="1" stopColor="#5b21b6" /></linearGradient>
        <linearGradient id="gB" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stopColor="#ecfccb" /><stop offset="1" stopColor="#65a30d" /></linearGradient>
        <linearGradient id="gC" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stopColor="#cffafe" /><stop offset="1" stopColor="#0891b2" /></linearGradient>
      </defs>
      <g className="sf-gem sf-gem--a">
        <path d="M70 40h80l30 40-70 90-70-90z" fill="url(#gA)" />
        <path d="M40 80h140M70 40l40 130M150 40l-40 130M70 40l-30 40M150 40l30 40" stroke="rgba(255,255,255,.55)" strokeWidth="1.4" fill="none" />
        <path d="M70 40h80l-40 40z" fill="rgba(255,255,255,.28)" />
      </g>
      <g className="sf-gem sf-gem--b">
        <path d="M168 120h28l10 14-24 30-24-30z" fill="url(#gB)" />
        <path d="M158 134h48M168 120l14 44M196 120l-14 44" stroke="rgba(255,255,255,.6)" strokeWidth="1" fill="none" />
      </g>
      <g className="sf-gem sf-gem--c">
        <path d="M18 128h24l9 12-21 26-21-26z" fill="url(#gC)" />
        <path d="M9 140h42M18 128l12 38M42 128l-12 38" stroke="rgba(255,255,255,.6)" strokeWidth="1" fill="none" />
      </g>
      <circle cx="190" cy="40" r="3" fill="#fff" opacity=".8" className="sf-spark" />
      <circle cx="30" cy="60" r="2" fill="#fff" opacity=".6" className="sf-spark sf-spark--2" />
      <circle cx="120" cy="18" r="2.5" fill="#fff" opacity=".7" className="sf-spark sf-spark--3" />
    </svg>
  );
}

function StoreHero({
  hero, opsLevel, fallbackLink, payMethods,
}: {
  hero: { content: HeroContent; highlights: string[] };
  opsLevel: 'open' | 'busy' | 'closed' | null;
  fallbackLink: string;
  payMethods: string[];
}) {
  const { content } = hero;
  const titleLines = (content.title || '').split('\n');
  // Dot colour follows the measured ops state so text and colour agree.
  const dot = opsLevel === 'busy' ? '#fbbf24' : opsLevel === 'closed' ? 'rgba(255,255,255,.55)' : '#a3e635';
  const live = opsLevel !== 'closed';
  const cta = !content.ctaLink || content.ctaLink === '#arsenal' ? fallbackLink : content.ctaLink;

  return (
    <div className="sf-hero relative overflow-hidden px-5 py-6 text-white sm:px-9 sm:py-9">
      <div className="sf-hero-grid" aria-hidden="true" />
      <div className="sf-hero-glow" aria-hidden="true" />
      <div className="sf-hero-art pointer-events-none absolute" aria-hidden="true">
        <GemArt />
      </div>

      <div className="relative sm:max-w-[60%]">
        <span className="inline-flex max-w-full items-center gap-2 rounded-full px-3 py-1.5 text-[11.5px] font-bold sm:text-[12px]"
          style={{ background: 'rgba(255,255,255,.12)', border: '1px solid rgba(255,255,255,.18)', backdropFilter: 'blur(6px)' }}>
          <span className={`${live ? 'v-blink ' : ''}inline-block h-1.5 w-1.5 shrink-0 rounded-full`}
            style={{ background: dot, boxShadow: live ? `0 0 8px ${dot}` : undefined }} />
          <span className="min-w-0 truncate">{content.status}</span>
        </span>

        <h1 className="mt-3 font-extrabold leading-[1.12]" style={{ fontSize: 'clamp(1.4rem,4.4vw,2.6rem)', letterSpacing: '-.025em' }}>
          {titleLines.map((l, i) => (
            <span key={i} className={i === titleLines.length - 1 ? 'sf-hero-accent block' : 'block'}>{l}</span>
          ))}
        </h1>

        <p className="mt-2 line-clamp-3 max-w-xl text-[13px] leading-relaxed sm:text-[15.5px]" style={{ color: 'rgba(255,255,255,.84)' }}>
          {content.subtitle}
        </p>

        <div className="mt-4 flex flex-wrap items-center gap-x-2 gap-y-2 sm:mt-5 sm:gap-x-3">
          <Link href={cta} className="sf-hero-cta">
            {content.ctaLabel}
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" aria-hidden="true"><path d="M5 12h13M12 5l7 7-7 7" /></svg>
          </Link>
          <Link href="/tutorial" className="sf-hero-link">
            কিভাবে অর্ডার করবেন
          </Link>
        </div>
      </div>

      {(payMethods.length > 0 || hero.highlights.length > 0) && (
        <div className="relative mt-5 flex flex-wrap items-center gap-x-4 gap-y-2 border-t pt-4 text-[12px] font-semibold sm:mt-7"
          style={{ borderColor: 'rgba(255,255,255,.14)' }}>
          {payMethods.length > 0 && (
            <span className="flex flex-wrap items-center gap-1.5">
              <span style={{ color: 'rgba(255,255,255,.7)' }}>পেমেন্ট:</span>
              {payMethods.map((m) => (
                <span key={m} className="rounded-md px-1.5 py-0.5" style={{ background: 'rgba(255,255,255,.12)' }}>{PAY_LABEL[m] ?? m}</span>
              ))}
            </span>
          )}
          {/* only the admin's STRIP campaign — never default claims */}
          {hero.highlights.slice(0, 3).map((h, i) => (
            <span key={i} className="inline-flex items-center gap-1.5" style={{ opacity: 0.92 }}>
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" style={{ stroke: 'var(--hero-accent)' }} strokeWidth="3" aria-hidden="true"><path d="M4 12.5l5.5 5.5L20 7" /></svg>
              {h}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

function ProductTile({ p, tone, i = 0 }: { p: SProduct; tone: { g1: string; g2: string }; i?: number }) {
  const t = useT();
  const mono = p.name.trim().charAt(0) || 'U';
  const badge = p.soldOut
    ? { t: t('common.soldOut'), c: 'var(--badge-sold)' }
    : p.discountPct > 0
      ? { t: `${p.discountPct}% ${t('common.discount')}`, c: 'var(--badge-sale)' }
      : p.popular
        ? { t: t('common.popular'), c: 'var(--badge-popular)' }
        : p.isNew
          ? { t: t('common.new'), c: 'var(--badge-new)' }
          : null;

  return (
    <Link
      href={`/product/${p.id}/${p.slug}`}
      className="sf-tile sf-rv group"
      style={{ ['--i' as string]: i % 6 }}
      aria-disabled={p.soldOut}
      data-soldout={p.soldOut ? '1' : undefined}
    >
      <div className="sf-tile-media">
        <ProductImage src={p.image} alt={p.name} tone={tone} mono={mono} />
        {badge && <span className="sf-badge" style={{ background: badge.c }}>{badge.t}</span>}
      </div>
      <div className="sf-tile-body">
        <p className="sf-tile-name" title={p.name}>{p.name}</p>
        <p className="sf-tile-price">
          {p.startingPrice != null ? (
            <>
              <span className="sf-tile-from">{t('common.startingAt')}</span>
              <span className="sf-tile-amt">{bdt(p.startingPrice)}</span>
            </>
          ) : <span className="sf-tile-from">—</span>}
        </p>
      </div>
    </Link>
  );
}
