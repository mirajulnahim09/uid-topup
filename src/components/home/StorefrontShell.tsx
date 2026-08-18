'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import { useT } from '@/components/i18n/I18nProvider';
import ProductImage from '@/components/fx/ProductImage';

/** হিরো কনটেন্ট — অ্যাডমিন-নিয়ন্ত্রিত, page.tsx-এ তৈরি */
export type HeroContent = {
  status: string;
  title: string;      // '\n' থাকলে একাধিক লাইন
  subtitle: string;
  ctaLabel: string;
  ctaLink: string;
  imageUrl: string | null;
};

/**
 * ═══════════════════════════════════════════════════════════
 * ★ STOREFRONT SHELL — reference-শৈলীর ৩-কলাম দোকান-বিন্যাস
 *
 *   বাঁয়ে: আঠালো ক্যাটাগরি সাইডবার (ফিল্টার)
 *   মাঝে: হিরো ব্যানার → প্রমো → ফিচারড → মূল গ্রিড
 *   ডানে: আঠালো লাইভ "Latest Orders" ফিড + সার্ভিস + পেমেন্ট
 *
 *   ⚠️ এই কম্পোনেন্ট কোনো DB call করে না — page.tsx ইতিমধ্যে
 *   fetch-করা সৎ ডেটা (showcaseCats, featured, deliveries) prop
 *   হিসেবে নেয়। সব ব্যাজ/দাম/জনপ্রিয়তা সার্ভারেই হিসাব হয়েছে।
 *   মোবাইলে সাইডবার → hamburger drawer + অনুভূমিক চিপ-সারি।
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

const bdt = (n: number) =>
  '৳' + n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

// ক্যাটাগরির নাম → রঙ পরিবার (DARK: স্বচ্ছ টিন্ট + উজ্জ্বল গ্লিফ)
// bg/fg = ছোট আইকন-টাইল (গাঢ় থিমে ভাসমান আলোকিত টোকেন)
// g1/g2 = প্রোডাক্ট থাম্বনেইলের উজ্জ্বল গ্রেডিয়েন্ট (গাঢ়তে দারুণ ফোটে)
const PALETTE = [
  { bg: 'rgba(163,230,53,.15)', fg: '#bef264', g1: '#a3e635', g2: '#4d7c0f' },
  { bg: 'rgba(251,191,36,.15)', fg: '#fcd34d', g1: '#fbbf24', g2: '#b45309' },
  { bg: 'rgba(56,189,248,.15)', fg: '#7dd3fc', g1: '#38bdf8', g2: '#0369a1' },
  { bg: 'rgba(139,92,246,.18)', fg: '#c4b5fd', g1: '#a78bfa', g2: '#6d28d9' },
  { bg: 'rgba(244,63,94,.15)',  fg: '#fb7185', g1: '#f43f5e', g2: '#be123c' },
  { bg: 'rgba(45,212,191,.15)', fg: '#5eead4', g1: '#2dd4bf', g2: '#0284c7' },
];
const pal = (i: number) => PALETTE[i % PALETTE.length];

function timeAgo(iso: string): string {
  const s = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return 'এইমাত্র';
  const m = Math.floor(s / 60);
  if (m < 60) return `${m} মিনিট আগে`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h} ঘণ্টা আগে`;
  return `${Math.floor(h / 24)} দিন আগে`;
}

// ছোট SVG আইকন সেট — ইমোজি নয় (প্ল্যাটফর্মভেদে বদলায় না)
function CatIcon({ name }: { name?: string | null }) {
  const k = (name || '').toLowerCase();
  const p =
    k.includes('sub') || k.includes('সাব') || k.includes('নেট') || k.includes('ইউটিউব') ? (
      <>
        <rect x="2" y="4" width="20" height="16" rx="3" /><path d="M10 9l5 3-5 3z" />
      </>
    ) : k.includes('mem') || k.includes('মেম') || k.includes('vip') ? (
      <path d="M2 18h20M4 18l-2-9 5 4 5-8 5 8 5-4-2 9z" />
    ) : k.includes('pass') || k.includes('পাস') ? (
      <>
        <path d="M3 8a2 2 0 012-2h14a2 2 0 012 2v2a2 2 0 000 4v2a2 2 0 01-2 2H5a2 2 0 01-2-2v-2a2 2 0 000-4z" />
        <path d="M13 6v12" />
      </>
    ) : k.includes('smm') || k.includes('like') || k.includes('লাইক') ? (
      <>
        <path d="M12 2c3 2 5 6 5 10l-3 3H10l-3-3c0-4 2-8 5-10z" />
        <path d="M8 16l-2 5 4-2M16 16l2 5-4-2" />
      </>
    ) : k.includes('voucher') || k.includes('ভাউচার') || k.includes('gift') ? (
      <>
        <rect x="3" y="8" width="18" height="13" rx="1.5" />
        <path d="M3 12h18M12 8v13" />
      </>
    ) : (
      // default: diamond (Free Fire)
      <>
        <path d="M6 3h12l4 6-10 12L2 9z" />
        <path d="M2 9h20" />
      </>
    );
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">{p}</svg>
  );
}

export default function StorefrontShell({
  hero,
  categories,
  featured,
  deliveries,
  supportHours,
}: {
  hero: { content: HeroContent; highlights: string[] };
  categories: SCat[];
  featured: SProduct[];
  deliveries: Delivery[];
  supportHours?: string;
}) {
  const [active, setActive] = useState<number | 'all'>('all');
  const [drawer, setDrawer] = useState(false);
  const t = useT();

  const allProducts = useMemo(
    () => categories.flatMap((c) => c.products),
    [categories],
  );
  const total = allProducts.length;

  const shown = active === 'all' ? allProducts : allProducts.filter((p) => p.categoryId === active);
  const activeName = active === 'all' ? t('home.allProducts') : categories.find((c) => c.id === active)?.name;

  useEffect(() => {
    document.body.style.overflow = drawer ? 'hidden' : '';
    return () => { document.body.style.overflow = ''; };
  }, [drawer]);

  function pick(id: number | 'all') {
    setActive(id);
    setDrawer(false);
    document.getElementById('catalog')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  const catIndex = (id: number) => categories.findIndex((c) => c.id === id);

  return (
    <section className="mx-auto max-w-7xl px-4 pb-16 pt-5 sm:px-6">
      {/**
        * ★★★ ট্র্যাকের সংখ্যা **দৃশ্যমান কলামের সংখ্যার সমান** হতে হবে।
        *
        *   আগে `lg` থেকেই তিনটি ট্র্যাক (`240px 1fr 300px`) ঘোষণা করা
        *   ছিল, অথচ ডান সাইডবারটি (`aside`, নিচে) দেখা যায় কেবল `xl`
        *   থেকে। ফলে ১০২৪–১২৭৯px পরিসরে ডানদিকের ৩০০px ট্র্যাকটি
        *   **খালি পড়ে থাকত** — grid ট্র্যাক শিশুটি `display:none`
        *   হলেও জায়গা ছাড়েই।
        *
        *   মাপা ফল (১০২৪px): মাঝের কলাম ৪১২px, তার ভিতরে
        *   `lg:grid-cols-4` — প্রতিটি প্রোডাক্ট কার্ড মাত্র **৯০px**।
        *   কার্ডের ভিতরের প্যাডিং বাদে ৬০px জায়গায় দাম বসত ৭৩px,
        *   তাই `.prod-card` এর `overflow:hidden` দামের ডান দিক
        *   ৫–১৩px কেটে দিত আর তীর-বোতামটি ০px এ চুপসে যেত।
        *
        *   এখন ট্র্যাক দুই ধাপে: `lg` এ দুটি, `xl` এ তিনটি — যেখানে
        *   যতগুলো কলাম সত্যিই দেখা যায়।
        */}
      <div className="grid gap-5 lg:grid-cols-[240px_1fr] xl:grid-cols-[240px_1fr_300px]">
        {/* ─────────── বাঁ সাইডবার (ডেস্কটপ) ─────────── */}
        <aside className="hidden self-start lg:block" style={{ position: 'sticky', top: 88 }}>
          <div className="card overflow-hidden">
            <div
              className="flex items-center gap-2 px-4 py-3.5 text-[13px] font-extrabold"
              style={{ borderBottom: '1px solid var(--v-edge)', color: 'var(--v-ink)' }}
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="var(--violet)" strokeWidth="2">
                <rect x="3" y="3" width="7" height="7" rx="1.5" /><rect x="14" y="3" width="7" height="7" rx="1.5" />
                <rect x="3" y="14" width="7" height="7" rx="1.5" /><rect x="14" y="14" width="7" height="7" rx="1.5" />
              </svg>
              {t('common.category')}
            </div>
            <CatList
              categories={categories}
              total={total}
              active={active}
              onPick={pick}
              catIndex={catIndex}
            />
          </div>

          {/* সহায়তা কার্ড */}
          <div
            className="mt-4 overflow-hidden rounded-2xl p-5 text-white"
            style={{ background: 'linear-gradient(140deg,#7c3aed,#6d28d9)', boxShadow: '0 12px 40px -12px rgba(109,40,217,.4)' }}
          >
            <p className="text-[15px] font-extrabold">{t('common.needHelp')}</p>
            <p className="mt-1.5 text-[12.5px] leading-relaxed" style={{ opacity: 0.85 }}>
              অর্ডার নিয়ে সমস্যা হলে Transaction ID সহ মেসেঞ্জারে যোগাযোগ করুন — দ্রুত সমাধান হয়।
            </p>
            <Link
              href="/contact"
              className="mt-3.5 flex min-h-[40px] items-center justify-center gap-2 rounded-[10px] text-[13px] font-bold"
              style={{ background: 'rgba(255,255,255,.16)' }}
            >
              {t('common.contactUs')}
            </Link>
          </div>
        </aside>

        {/* ─────────── মাঝের কলাম ─────────── */}
        <main className="min-w-0">
          <StoreHero hero={hero} onHamburger={() => setDrawer(true)} />

          {/* প্রমো স্ট্রিপ */}
          <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3">
            <Promo tone="lime" title={t('home.fastDelivery')} sub="২০ মিনিটের ভিতরে"
              icon={<path d="M13 2L3 14h7l-1 8 10-12h-7z" />} />
            <Promo tone="ice" title={t('home.securePay')} sub="bKash · Nagad · Rocket"
              icon={<><rect x="2" y="5" width="20" height="14" rx="2" /><path d="M2 10h20" /></>} />
            <Promo tone="brand" title={t('home.support247')} sub="মেসেঞ্জারে যোগাযোগ" wide
              icon={<path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z" />} />
          </div>

          {/* মোবাইল ক্যাটাগরি চিপ */}
          <div className="mt-5 flex gap-2 overflow-x-auto pb-1 lg:hidden" style={{ scrollbarWidth: 'none' }}>
            <Chip on={active === 'all'} onClick={() => pick('all')}>{t('common.all')}</Chip>
            {categories.map((c) => (
              <Chip key={c.id} on={active === c.id} onClick={() => pick(c.id)}>{c.name}</Chip>
            ))}
          </div>

          {/* ফিচারড রেল — শুধু যদি প্রকৃত বেস্ট-সেলার থাকে */}
          {featured.length > 0 && (
            <>
              <SecHead title={t('home.popular')} href="#catalog" hrefLabel={t('common.viewAll')} />
              {/**
                * ⚠️ ঠিক **একটি** ফিচারড পণ্য থাকলে দুই-কলাম গ্রিডে ডান
                *   ঘরটি ফাঁকা পড়ে থাকত — ৩৯০px স্ক্রিনশটে সেটি "লোড
                *   হয়নি" বা "ভেঙে গেছে" এর মতো দেখাত। একটি আইটেমের
                *   সেকশনে ফাঁকা ঘর মানে গ্রিডের স্বাভাবিক আচরণ নয়,
                *   একটি অসমাপ্ত সারি।
                *   তাই সংখ্যা ১ হলে কার্ডটি পুরো প্রস্থ নেয় — "সবচেয়ে
                *   জনপ্রিয়" একটিমাত্র বাছাই হিসেবে এটিই স্বাভাবিক দেখায়।
                */}
              <div className={`grid gap-3 sm:grid-cols-3 lg:grid-cols-4 ${featured.length === 1 ? 'grid-cols-1' : 'grid-cols-2'}`}>
                {featured.slice(0, 4).map((p) => (
                  <ProductCard key={p.id} p={p} tone={pal(Math.max(0, catIndex(p.categoryId)))} />
                ))}
              </div>
            </>
          )}

          {/* মূল ক্যাটালগ */}
          <div id="catalog" />
          <SecHead title={activeName || t('home.allProducts')} />
          {shown.length > 0 ? (
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
              {shown.map((p) => (
                <ProductCard key={p.id} p={p} tone={pal(Math.max(0, catIndex(p.categoryId)))} />
              ))}
            </div>
          ) : (
            <div className="card px-6 py-14 text-center">
              <p className="text-sm" style={{ color: 'var(--v-mut)' }}>
                এই মুহূর্তে এই ক্যাটাগরিতে কোনো প্রোডাক্ট নেই।
              </p>
            </div>
          )}

          {/* ─── লাইভ অর্ডার (মোবাইল/ট্যাবলেট) ───
              ডান সাইডবার শুধু xl+ এ দেখা যায়, তাই ছোট পর্দায় সামাজিক
              প্রমাণটাই হারিয়ে যেত — অথচ এই বাজারের অধিকাংশ ক্রেতা মোবাইলে।
              সিদ্ধান্তের ঠিক নিচে (ক্যাটালগের পরে) একই সৎ ডেটা দেখাই। */}
          {deliveries.length > 0 && (
            <div className="card mt-8 overflow-hidden xl:hidden">
              <div className="flex items-center justify-between px-4 py-3.5" style={{ borderBottom: '1px solid var(--v-edge)' }}>
                <span className="flex items-center gap-2 text-[13px] font-extrabold" style={{ color: 'var(--v-ink)' }}>
                  <span className="v-blink inline-block h-2 w-2 rounded-full" style={{ background: 'var(--v-volt-surf)', boxShadow: '0 0 8px var(--v-volt-surf)' }} />
                  {t('home.latestOrders')}
                </span>
                <span className="hud-mut hud" style={{ fontSize: 10 }}>{t('home.completed')}</span>
              </div>
              <div>
                {deliveries.slice(0, 6).map((d, i) => {
                  const c = pal(i);
                  return (
                    <div key={d.id} className="flex items-center gap-3 px-4 py-3" style={{ borderBottom: '1px solid rgba(255,255,255,.05)' }}>
                      <span className="grid h-9 w-9 shrink-0 place-items-center rounded-[11px] text-[15px] font-extrabold text-white"
                        style={{ background: `linear-gradient(135deg,${c.g1},${c.g2})` }}>
                        {d.name.trim().charAt(0) || 'U'}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-[13px] font-bold" style={{ color: 'var(--v-ink)' }}>{d.name}</span>
                        <span className="block truncate text-[11.5px]" style={{ color: 'var(--v-mut)' }}>{d.productName}</span>
                      </span>
                      <span className="shrink-0 text-right">
                        <span className="inline-block rounded-[5px] px-1.5 py-0.5 text-[9.5px] font-extrabold"
                          style={{ background: 'rgba(163,230,53,.16)', color: '#bef264' }}>সম্পন্ন</span>
                        <span className="mt-0.5 block whitespace-nowrap text-[10px]" style={{ color: 'var(--v-dim)' }}>{timeAgo(d.at)}</span>
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </main>

        {/* ─────────── ডান কলাম (লাইভ ফিড) ─────────── */}
        <aside className="hidden flex-col gap-4 self-start xl:flex" style={{ position: 'sticky', top: 88 }}>
          {deliveries.length > 0 && (
            <div className="card overflow-hidden">
              <div className="flex items-center justify-between px-4 py-3.5" style={{ borderBottom: '1px solid var(--v-edge)' }}>
                <span className="flex items-center gap-2 text-[13px] font-extrabold" style={{ color: 'var(--v-ink)' }}>
                  <span className="v-blink inline-block h-2 w-2 rounded-full" style={{ background: '#16a34a', boxShadow: '0 0 8px #16a34a' }} />
                  {t('home.latestOrders')}
                </span>
                <span className="hud-mut hud" style={{ fontSize: 10 }}>{t('home.completed')}</span>
              </div>
              <div className="max-h-[440px] overflow-y-auto">
                {deliveries.map((d, i) => {
                  const c = pal(i);
                  return (
                    <div key={d.id} className="flex items-center gap-3 px-4 py-3" style={{ borderBottom: '1px solid rgba(255,255,255,.05)' }}>
                      <span className="grid h-9 w-9 shrink-0 place-items-center rounded-[11px] text-[15px] font-extrabold text-white"
                        style={{ background: `linear-gradient(135deg,${c.g1},${c.g2})` }}>
                        {d.name.trim().charAt(0) || 'U'}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-[13px] font-bold" style={{ color: 'var(--v-ink)' }}>{d.name}</span>
                        <span className="block truncate text-[11.5px]" style={{ color: 'var(--v-mut)' }}>{d.productName}</span>
                      </span>
                      <span className="shrink-0 text-right">
                        <span className="inline-block rounded-[5px] px-1.5 py-0.5 text-[9.5px] font-extrabold"
                          style={{ background: 'rgba(163,230,53,.16)', color: '#bef264' }}>সম্পন্ন</span>
                        <span className="mt-0.5 block whitespace-nowrap text-[10px]" style={{ color: 'var(--v-dim)' }}>{timeAgo(d.at)}</span>
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* সার্ভিস কার্ড */}
          <div className="card p-4">
            <p className="mb-3 text-[13px] font-extrabold" style={{ color: 'var(--v-ink)' }}>আমাদের সার্ভিস</p>
            <ServiceRow tone="#bef264" bg="rgba(163,230,53,.15)" label="দ্রুত ও সহজ ডেলিভারি"
              icon={<path d="M13 2L3 14h7l-1 8 10-12h-7z" />} />
            <ServiceRow tone="#7dd3fc" bg="rgba(56,189,248,.15)" label="১০০% নিরাপদ পেমেন্ট"
              icon={<path d="M12 3l8 4v5c0 5-3.5 8-8 9-4.5-1-8-4-8-9V7z" />} />
            <ServiceRow tone="#c4b5fd" bg="rgba(139,92,246,.18)" label="সবচেয়ে কম দামে"
              icon={<><rect x="2" y="5" width="20" height="14" rx="2" /><path d="M2 10h20" /></>} />
            <ServiceRow tone="#fb7185" bg="rgba(244,63,94,.15)" label={supportHours ? `সাপোর্ট: ${supportHours}` : '২৪/৭ সাপোর্ট'}
              icon={<path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z" />} />
          </div>

          {/* পেমেন্ট কার্ড */}
          <div className="overflow-hidden rounded-2xl p-4 text-white" style={{ background: 'linear-gradient(140deg,#0f172a,#1e293b)' }}>
            <p className="mb-3 text-[11px] font-bold uppercase tracking-wider" style={{ opacity: 0.7 }}>পেমেন্ট মাধ্যম</p>
            <div className="flex flex-wrap gap-2">
              {[['bKash', '#ff6b9d'], ['Nagad', '#ff8080'], ['Rocket', '#c99df0'], ['Upay', '#ffb366']].map(([n, c]) => (
                <span key={n} className="rounded-[9px] px-3 py-1.5 text-[12.5px] font-extrabold"
                  style={{ background: 'rgba(255,255,255,.1)', color: c }}>{n}</span>
              ))}
            </div>
          </div>
        </aside>
      </div>

      {/* ─────────── মোবাইল ড্রয়ার ─────────── */}
      {drawer && (
        <div className="fixed inset-0 z-[70] lg:hidden" onClick={() => setDrawer(false)}
          style={{ background: 'rgba(15,23,41,.4)', backdropFilter: 'blur(2px)' }}>
          <div
            className="absolute left-0 top-0 bottom-0 flex w-[290px] max-w-[84vw] flex-col"
            style={{ background: 'var(--v-pit)', boxShadow: '8px 0 60px rgba(0,0,0,.6)' }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between px-4 py-4" style={{ borderBottom: '1px solid var(--v-edge)' }}>
              <span className="text-[15px] font-extrabold" style={{ color: 'var(--v-ink)' }}>ক্যাটাগরি</span>
              <button aria-label="বন্ধ করুন" onClick={() => setDrawer(false)}
                className="grid h-9 w-9 place-items-center rounded-[10px]" style={{ background: 'var(--v-void)', color: 'var(--v-mut)' }}>
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2"><path d="M6 6l12 12M18 6L6 18" /></svg>
              </button>
            </div>
            <div className="overflow-y-auto py-2">
              <CatList categories={categories} total={total} active={active} onPick={pick} catIndex={catIndex} />
            </div>
          </div>
        </div>
      )}
    </section>
  );
}

/* ─────────── সাব-কম্পোনেন্ট ─────────── */

function CatList({
  categories, total, active, onPick, catIndex,
}: {
  categories: SCat[]; total: number; active: number | 'all';
  onPick: (id: number | 'all') => void; catIndex: (id: number) => number;
}) {
  return (
    <div>
      {/* ⚠️ `<rect>` অবশ্যই `<svg>` এর ভেতরে — নাহলে ব্রাউজার ট্যাগটি
          চেনে না, আইকন-টাইল **ফাঁকা** থাকে আর React কনসোলে
          "tag <rect> is unrecognized" সতর্কতা দেয়। বাকি সারিগুলো
          `CatIconInline` ব্যবহার করে, যার ভেতরে svg আছে — কেবল এই
          একটি কল-সাইট বাদ পড়েছিল। */}
      <CatRow
        on={active === 'all'} onClick={() => onPick('all')}
        name="সব প্রোডাক্ট" count={total}
        bg="rgba(139,92,246,.18)" fg="#c4b5fd"
        icon={
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor"
            strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
            <rect x="3" y="3" width="7" height="7" rx="1.5" /><rect x="14" y="3" width="7" height="7" rx="1.5" />
            <rect x="3" y="14" width="7" height="7" rx="1.5" /><rect x="14" y="14" width="7" height="7" rx="1.5" />
          </svg>
        }
      />
      {categories.map((c) => {
        const p = pal(catIndex(c.id));
        return (
          <CatRow
            key={c.id} on={active === c.id} onClick={() => onPick(c.id)}
            name={c.name} count={c.products.length} bg={p.bg} fg={p.fg}
            icon={<CatIconInline name={c.icon || c.name} />}
          />
        );
      })}
    </div>
  );
}

function CatIconInline({ name }: { name?: string | null }) {
  return <CatIcon name={name} />;
}

function CatRow({
  on, onClick, name, count, bg, fg, icon,
}: {
  on: boolean; onClick: () => void; name: string; count: number;
  bg: string; fg: string; icon: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      className="relative flex w-full items-center gap-3 px-4 py-2.5 text-left text-[14px] font-semibold transition-colors"
      style={{
        borderTop: '1px solid var(--v-edge)',
        color: on ? '#c4b5fd' : 'var(--v-mut)',
        background: on ? 'rgba(139,92,246,.16)' : 'transparent',
      }}
    >
      {on && <span className="absolute left-0 top-0 bottom-0 w-[3px]" style={{ background: 'var(--violet)' }} />}
      <span className="grid h-[34px] w-[34px] shrink-0 place-items-center rounded-[9px]" style={{ background: bg, color: fg }}>
        <span style={{ color: fg }}>{icon}</span>
      </span>
      <span className="flex-1 leading-tight">{name}</span>
      <span className="rounded-full px-2 py-0.5 text-[11px] font-bold"
        style={{ background: on ? 'var(--v-steel)' : 'var(--v-fill2)', color: on ? '#c4b5fd' : 'var(--v-dim)' }}>{count}</span>
    </button>
  );
}

function StoreHero({ hero, onHamburger }: { hero: { content: HeroContent; highlights: string[] }; onHamburger: () => void }) {
  const { content } = hero;
  const titleLines = (content.title || '').split('\n');
  return (
    <div
      className="relative overflow-hidden rounded-[20px] p-6 text-white sm:p-8"
      style={{ background: 'linear-gradient(120deg,#4c1d95 0%,#6d28d9 42%,#8b5cf6 100%)', boxShadow: '0 12px 40px -12px rgba(109,40,217,.4)' }}
    >
      <div aria-hidden className="pointer-events-none absolute -right-16 -top-16 h-80 w-80 rounded-full"
        style={{ background: 'radial-gradient(circle,rgba(163,230,53,.32),transparent 65%)' }} />
      {/**
        * ═══ হিরোর উপরের সারি ═══
        *
        * ⚠️⚠️ আগে ক্যাটাগরি-বোতামটি `absolute right-4 top-4` ছিল আর
        *   স্ট্যাটাস-ব্যাজটি স্বাভাবিক প্রবাহে। ৩২০–৩৭৫px ফোনে ব্যাজের
        *   লেখা দুই লাইনে গড়াত এবং বোতামটির **নিচ দিয়ে চলে যেত** —
        *   ব্রাউজারে মাপা ওভারল্যাপ ৩২px × ৩২px (৩২০px ভিউপোর্ট,
        *   ব্যাজ x ৪০–২৮০ · y ২৩৪–২৮৭, বোতাম x ২৪৮–২৮৮ · y ২২৬–২৬৬)।
        *   অর্থাৎ বাজারের সবচেয়ে সরু ফোনে হিরোর প্রথম বাক্যটির শেষাংশ
        *   একটি বোতামের নিচে ঢাকা পড়ত।
        *
        *   এখন দুটি একই flex সারিতে — জ্যামিতিকভাবে আর কখনো
        *   একে অপরের উপর পড়তে পারে না, ব্যাজ যত লম্বাই হোক।
        *
        * ★ বোতামে এখন লেখাও আছে। কারণ: পাতার উপরেই ন্যাভবারের
        *   হ্যামবার্গার, আর এখানে দ্বিতীয় একটি **অভিন্ন ☰ গ্লিফ** —
        *   এক পর্দায় দুটি একরকম চিহ্ন দুটি সম্পূর্ণ আলাদা মেনু খুলত।
        *   লেবেল দিলে কোনটি কী তা আর অনুমান করতে হয় না।
        */}
      <div className="flex items-start justify-between gap-3">
        <span className="inline-flex min-w-0 items-center gap-2 rounded-full px-3 py-1.5 text-[12px] font-bold" style={{ background: 'rgba(255,255,255,.16)' }}>
          <span className="v-blink inline-block h-1.5 w-1.5 shrink-0 rounded-full" style={{ background: '#a3e635', boxShadow: '0 0 8px #a3e635' }} />
          <span className="min-w-0">{content.status}</span>
        </span>

        {/* মোবাইল/ট্যাবলেট: ক্যাটাগরি ড্রয়ার */}
        <button aria-label="সব ক্যাটাগরি দেখুন" onClick={onHamburger}
          className="inline-flex min-h-[44px] shrink-0 items-center gap-1.5 rounded-xl px-3 text-[12px] font-bold lg:hidden"
          style={{ background: 'rgba(255,255,255,.16)' }}>
          <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2" aria-hidden="true">
            <rect x="3" y="3" width="7" height="7" rx="1.5" /><rect x="14" y="3" width="7" height="7" rx="1.5" />
            <rect x="3" y="14" width="7" height="7" rx="1.5" /><rect x="14" y="14" width="7" height="7" rx="1.5" />
          </svg>
          <span className="hidden xs:inline">ক্যাটাগরি</span>
        </button>
      </div>

      <h1 className="mt-4 max-w-xl font-extrabold leading-[1.1]" style={{ fontSize: 'clamp(1.7rem,4vw,2.5rem)', letterSpacing: '-.02em' }}>
        {titleLines.map((l, i) => (
          <span key={i} className="block" style={i === titleLines.length - 1 ? { color: 'var(--accent-2)' } : undefined}>{l}</span>
        ))}
      </h1>

      <p className="mt-3.5 max-w-md text-[15px] leading-relaxed" style={{ opacity: 0.9 }}>{content.subtitle}</p>

      <div className="mt-5 flex flex-wrap gap-3">
        <Link href={content.ctaLink || '#catalog'}
          className="inline-flex min-h-[46px] items-center gap-2 rounded-xl px-6 text-[14px] font-bold"
          style={{ background: 'var(--accent)', color: 'var(--accent-ink)' }}>
          {content.ctaLabel}
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6"><path d="M5 12h13M12 5l7 7-7 7" /></svg>
        </Link>
        <Link href="#how"
          className="inline-flex min-h-[46px] items-center rounded-xl px-6 text-[14px] font-bold"
          style={{ background: 'rgba(255,255,255,.15)', border: '1.5px solid rgba(255,255,255,.25)' }}>
          কিভাবে অর্ডার করবেন
        </Link>
      </div>

      {hero.highlights.length > 0 && (
        <div className="mt-6 flex flex-wrap gap-x-6 gap-y-2">
          {hero.highlights.slice(0, 4).map((h, i) => (
            <span key={i} className="inline-flex items-center gap-1.5 text-[12.5px] font-semibold" style={{ opacity: 0.92 }}>
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#a3e635" strokeWidth="3"><path d="M4 12.5l5.5 5.5L20 7" /></svg>
              {h}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

function Promo({ tone, title, sub, icon, wide }: {
  tone: 'lime' | 'ice' | 'brand'; title: string; sub: string; icon: React.ReactNode; wide?: boolean;
}) {
  const map = {
    lime: { bg: 'linear-gradient(135deg,var(--v-steel),rgba(163,230,53,.10))', ic: '#4d7c0f' },
    ice: { bg: 'linear-gradient(135deg,var(--v-steel),rgba(56,189,248,.12))', ic: '#0369a1' },
    brand: { bg: 'linear-gradient(135deg,var(--v-steel),rgba(139,92,246,.14))', ic: '#6d28d9' },
  }[tone];
  return (
    <div className={`card v-panel--hov flex items-center gap-3 p-4 ${wide ? 'col-span-2 sm:col-span-1' : ''}`} style={{ background: map.bg }}>
      <span className="grid h-11 w-11 shrink-0 place-items-center rounded-[11px] text-white" style={{ background: map.ic }}>
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">{icon}</svg>
      </span>
      <span>
        <span className="block text-[13.5px] font-bold" style={{ color: 'var(--v-ink)' }}>{title}</span>
        <span className="block text-[11.5px]" style={{ color: 'var(--v-mut)' }}>{sub}</span>
      </span>
    </div>
  );
}

function Chip({ on, onClick, children }: { on: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button onClick={onClick}
      className="shrink-0 whitespace-nowrap rounded-full px-4 py-2 text-[13px] font-semibold transition-colors"
      style={{
        border: `1.5px solid ${on ? 'var(--violet)' : 'var(--v-edge2)'}`,
        background: on ? '#7c3aed' : 'var(--v-fill)',
        color: on ? '#fff' : 'var(--v-mut)',
      }}>{children}</button>
  );
}

function SecHead({ title, href, hrefLabel }: { title: string; href?: string; hrefLabel?: string }) {
  return (
    <div className="mb-4 mt-8 flex items-center justify-between">
      <h2 className="flex items-center gap-2.5 text-[20px] font-extrabold" style={{ letterSpacing: '-.02em', color: 'var(--v-ink)' }}>
        <span className="inline-block h-[22px] w-[5px] rounded-[3px]" style={{ background: 'linear-gradient(var(--violet),#8b5cf6)' }} />
        {title}
      </h2>
      {href && (
        /* ★ ট্যাপ-টার্গেট ৪৪px — মাপা ছিল ৬৪×**২২**px, অর্থাৎ WCAG 2.5.8
           (AA, ২৪×২৪) এর নিচে। শিরোনামের পাশে বসে বলে উচ্চতা চোখে পড়ে না,
           কিন্তু আঙুলে পড়ে। */
        <Link href={href} className="-mr-2 inline-flex min-h-[44px] items-center gap-1 px-2 text-[13px] font-bold" style={{ color: 'var(--violet)' }}>
          {hrefLabel}
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6"><path d="M5 12h13M12 5l7 7-7 7" /></svg>
        </Link>
      )}
    </div>
  );
}

function ServiceRow({ tone, bg, label, icon }: { tone: string; bg: string; label: string; icon: React.ReactNode }) {
  return (
    <div className="flex items-center gap-2.5 py-2 text-[12.5px] font-semibold" style={{ color: 'var(--v-ink)' }}>
      <span className="grid h-[30px] w-[30px] shrink-0 place-items-center rounded-[9px]" style={{ background: bg, color: tone }}>
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">{icon}</svg>
      </span>
      {label}
    </div>
  );
}

function ProductCard({ p, tone }: { p: SProduct; tone: { bg: string; fg: string; g1: string; g2: string } }) {
  const t = useT();
  const mono = (p.name.match(/\d+/)?.[0] || p.name.trim().charAt(0) || 'FF').slice(0, 3);
  const badge = p.soldOut
    ? { t: t('common.soldOut'), c: '#64748b' }
    : p.discountPct > 0
      ? { t: `${p.discountPct}% ${t('common.discount')}`, c: '#e11d48' }
      : p.popular
        ? { t: t('common.popular'), c: '#0284c7' }
        : p.isNew
          ? { t: t('common.new'), c: '#65a30d' }
          : null;

  return (
    <Link
      href={`/product/${p.id}/${p.slug}`}
      className="prod-card group flex flex-col"
      aria-disabled={p.soldOut}
      style={p.soldOut ? { opacity: 0.7 } : undefined}
    >
      {/* ★ কভার ইমেজ — আপলোড থাকলে পুরো কার্ড জুড়ে (আগে ছোট ৬৪px
          আইকন হিসেবে বসত); নাহলে পেশাদার fallback। একমাত্র উৎস: ProductImage */}
      <div className="relative overflow-hidden" style={{ aspectRatio: '1 / .82' }}>
        <ProductImage src={p.image} alt={p.name} tone={tone} mono={mono} />
        {badge && (
          <span className="absolute left-2.5 top-2.5 z-10 rounded-[7px] px-2 py-1 text-[10px] font-extrabold text-white" style={{ background: badge.c }}>{badge.t}</span>
        )}
      </div>
      <div className="flex flex-1 flex-col p-3.5">
        {/**
          * ★ `line-clamp-2` + স্থির দুই-লাইনের উচ্চতা।
          *
          *   কেন: নাম আগে যত লাইন লাগে তত নিত। "Free Fire Voucher for
          *   UniPin" দুই লাইন, "Free Fire Like" এক লাইন — একই সারির দুই
          *   কার্ডের ভিতরের ছন্দ আলাদা হয়ে যেত, আর কোনো একটি নাম তিন
          *   লাইনে গেলে **পুরো সারিটি** লম্বা হয়ে গ্রিডের ছন্দ ভাঙত।
          *   গ্রিডে কার্ডের মাপ অনুমানযোগ্য হওয়া দরকার।
          *
          *   ⚠️ `min-height` ব্যবহার করা হয়েছে, `height` নয় — বাংলা
          *   যুক্তাক্ষরের ascender/descender বেশি জায়গা নেয়, স্থির
          *   উচ্চতায় সেগুলো কাটা পড়ত।
          */}
        <p
          className="line-clamp-2 text-[14px] font-bold leading-tight"
          style={{ color: 'var(--v-ink)', minHeight: 'calc(2 * 1.25em)' }}
          title={p.name}
        >
          {p.name}
        </p>
        <div className="mt-auto flex items-end justify-between pt-3">
          <span>
            <span className="block text-[10px] font-semibold uppercase" style={{ color: 'var(--v-dim)' }}>{t('common.startingAt')}</span>
            <span className="text-[16px] font-extrabold" style={{ color: 'var(--violet)', fontFamily: "'Unbounded','Anek Bangla',sans-serif" }}>
              {p.startingPrice != null ? bdt(p.startingPrice) : '—'}
            </span>
          </span>
          <span className="grid h-[34px] w-[34px] place-items-center rounded-[10px] transition-all group-hover:scale-105"
            style={{ background: 'rgba(139,92,246,.16)', color: 'var(--violet)' }}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4"><path d="M5 12h13M12 5l7 7-7 7" /></svg>
          </span>
        </div>
        {(p.orderCount > 0) && (
          <div className="mt-2.5 flex items-center gap-1.5 border-t pt-2.5 text-[11px]" style={{ borderColor: 'var(--v-edge)', color: 'var(--v-mut)' }}>
            <span style={{ color: '#f59e0b' }}>★</span> {p.orderCount.toLocaleString('bn-BD')}+ বিক্রি
          </div>
        )}
      </div>
    </Link>
  );
}
