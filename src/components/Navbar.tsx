'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useSession, signOut } from 'next-auth/react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { fmtShort } from '@/lib/date';
import { fetchMe, fetchNotifications, invalidateNotifications } from '@/lib/clientFetch';
import VoltMark from '@/components/fx/VoltMark';
import { useT } from '@/components/i18n/I18nProvider';
import LanguageToggle from '@/components/i18n/LanguageToggle';
import ThemeToggle from '@/components/theme/ThemeToggle';
import AccentPicker from '@/components/theme/AccentPicker';
import { BRAND, isDefaultBrand } from '@/lib/brand';
import BrandLogo from '@/components/brand/BrandLogo';
import type { LogoPair } from '@/lib/branding';

/**
 * ═══════════════════════════════════════════════════════════
 * ★ VOLT navigation — শুধু দৃশ্যগত পুনর্নির্মাণ
 *
 *   ⚠️ কোনো আচরণ বদলানো হয়নি: সেশন, ব্যালেন্স পোলিং,
 *   নোটিফিকেশন de-dup, mark-as-read, বাইরে-ক্লিকে বন্ধ,
 *   Escape, মেনু খোলা অবস্থায় scroll lock — সবই আগের মতোই।
 *   বদলেছে কেবল চেহারা ও তথ্যের ক্রম।
 *
 *   নকশার তিনটি সিদ্ধান্ত:
 *   ১. **লোগো এখন প্রকৃত চিহ্ন** — আগে ছিল সাইটের নামের প্রথম
 *      অক্ষর একটি বেগুনি চৌকোয়, যা কোনো ব্র্যান্ড নয়।
 *   ২. **ওয়ালেট আর সবুজ নয়** — সবুজ এখন কেবল "লাইভ/সফল"
 *      অবস্থার রঙ। ব্যালেন্স একটি তথ্য, তাই বরফ-নীল (ice)।
 *   ৩. **নোটিফিকেশন প্যানেল আর সাদা নয়** — আগে `bg-white` ও
 *      `text-slate-900` ছিল, যেগুলো theme-bridge দিয়ে কোনোমতে
 *      পাঠযোগ্য থাকত। এখন সরাসরি VOLT টোকেনে লেখা।
 * ═══════════════════════════════════════════════════════════
 */

type N = {
  id: string; title: string; body: string;
  link: string | null; isRead: boolean; createdAt: string;
};
type Cat = { id: number; name: string };

export default function Navbar({
  siteName = BRAND.name,
  logo,
  brandLogos,
  categories = [],
}: {
  siteName?: string;
  logo?: string | null;
  /** অ্যাডমিনের আপলোড করা প্রধান লোগো (dark/light) */
  brandLogos?: LogoPair;
  categories?: Cat[];
}) {
  const { data: session, status } = useSession();
  const path = usePathname();
  const t = useT();

  const [balance, setBalance] = useState<string | null>(null);
  const [menu, setMenu] = useState(false);
  const [bell, setBell] = useState(false);
  const [notifs, setNotifs] = useState<N[]>([]);
  const [unread, setUnread] = useState(0);

  const bellRef = useRef<HTMLDivElement>(null);
  const authed = status === 'authenticated';
  const isAdmin = session?.user?.role === 'ADMIN';

  // ★★★ কন্টেন্ট-সচেতন breakpoint — নেভ কখনো wrap/overflow করবে না।
  //   লগইন করা বার ঘন (ব্যালেন্স+বেল+অ্যাকাউন্ট লিংক+টগল), যা ১২৮০px-এ
  //   এক লাইনে **শারীরিকভাবেই** আঁটে না (font ছোট করা নিষেধ)। তাই
  //   লগইন-বার চওড়া পর্দায় full-nav, তার নিচে পরিষ্কার হ্যামবার্গার।
  //   দুই literal ক্লাস-স্ট্রিং থাকায় Tailwind JIT দুটোই তৈরি করে।
  //
  //   ⚠️ **১৪৪০ নয় — ১৫২০।** breakpoint-টি ঠিক সেই প্রস্থে চালু হতো
  //   যেখানে বিন্যাসটি আঁটে না: কন্টেইনার `max-w-[1440px]` + `xl:px-4`,
  //   তাই ১৪৪০px ভিউপোর্টে ব্যবহারযোগ্য প্রস্থ ১৪০৮ — কিন্তু পূর্ণ
  //   লগইন-বারের দরকার ১৪৭১। ফলে ঠিক ১৪৪০px-এ পাতাটি ৩১px অনুভূমিকভাবে
  //   উপচে পড়ত (Playwright-এ মাপা: `scrollWidth 1471 − clientWidth 1440`,
  //   অপরাধী = "লগআউট" বোতাম, right=1471)। breakpoint সবসময় সেই প্রস্থের
  //   **উপরে** হতে হয় যেখানে বিন্যাসটি সত্যিই আঁটে, নাহলে সীমানায়
  //   প্রতিবার ওভারফ্লো।
  const navFlex = authed ? 'min-[1520px]:flex' : 'xl:flex';
  const navHidden = authed ? 'min-[1520px]:hidden' : 'xl:hidden';

  const load = useCallback(async () => {
    if (status !== 'authenticated') return;
    try {
      // ★ শেয়ার্ড de-dup (4.5) — Navbar, MobileTabBar ও OrderForm
      //   একসাথে মাউন্ট হলেও নেটওয়ার্কে একটিই অনুরোধ যায়
      const [me, d] = await Promise.all([
        fetchMe<{ balance: string }>(),
        fetchNotifications<{ items: unknown[]; unread: number }>(),
      ]);
      setBalance(me.balance);
      setNotifs(d.items as never);
      setUnread(d.unread);
    } catch { /* silent */ }
  }, [status]);

  useEffect(() => { load(); }, [path, load]);

  useEffect(() => {
    if (status !== 'authenticated') return;
    const t = setInterval(load, 60_000);
    return () => clearInterval(t);
  }, [status, load]);

  useEffect(() => {
    if (!bell) return;
    const onClick = (e: MouseEvent) => {
      if (bellRef.current && !bellRef.current.contains(e.target as Node)) setBell(false);
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setBell(false); };
    document.addEventListener('mousedown', onClick);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onClick);
      document.removeEventListener('keydown', onKey);
    };
  }, [bell]);

  useEffect(() => {
    document.body.style.overflow = menu ? 'hidden' : '';
    return () => { document.body.style.overflow = ''; };
  }, [menu]);

  async function markRead() {
    setUnread(0);
    setNotifs((n) => n.map((x: (typeof n)[number]) => ({ ...x, isRead: true })));
    // ★ ক্যাশ বাতিল (4.5) — নাহলে পড়া-চিহ্নিত করার পরেও
    //   ৫ সেকেন্ড পর্যন্ত পুরনো unread সংখ্যা ফিরে আসত
    invalidateNotifications();
    try { await fetch('/api/notifications', { method: 'PATCH' }); } catch { /* */ }
  }

  return (
    <header
      className="sticky top-0 z-40 backdrop-blur-xl"
      style={{
        background: 'var(--surface-nav)',
        borderBottom: '1px solid var(--v-edge)',
      }}
    >
      {/* উপরের শক্তি-রেখা — ন্যাভবারকে "চালু যন্ত্র" মনে করায় */}
      <div aria-hidden="true" className="v-flow-line absolute inset-x-0 top-0 h-px" />

      {/* ★ কন্টেইনার প্রশস্ত (max-w-7xl → 1440px) + xl-এ প্যাডিং কমানো:
          বড় স্ক্রিনে আগে অব্যবহৃত অনুভূমিক জায়গা (1920px-এ ৬৪০px) নেভ
          এখন কাজে লাগায় — টেক্সট ছোট না করেই সব এক লাইনে (req #3)। */}
      <div className="mx-auto max-w-[1440px] px-4 sm:px-6 xl:px-4">
        <div className="flex h-[68px] items-center justify-between gap-3">
          {/* ── ব্র্যান্ড ── */}
          <Link href="/" className="group flex min-h-[44px] shrink-0 items-center gap-2.5" aria-label={siteName}>
            {/* ★★★ অ্যাডমিনের আপলোড করা লোগো (থিম-সচেতন) সর্বোচ্চ অগ্রাধিকার।
                লোগো থাকলে শুধু সেটিই — পাশে সাইটের নাম আবার লিখলে
                বেশিরভাগ ওয়ার্ডমার্কে নামটি দুবার দেখাত। */}
            {brandLogos && (brandLogos.dark || brandLogos.light) ? (
              <BrandLogo logos={brandLogos} slot="primary" alt={siteName} height={38} priority />
            ) : logo ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={logo} alt={siteName} className="h-10 w-auto" />
            ) : (
              <>
                <VoltMark size={36} uid="nav" />
                {/* ⚠️ আগে এটি `hidden xs:block` ছিল (xs = 400px), অর্থাৎ
                    ৩৯০px চওড়া ফোনে — অর্থাৎ বাজারের সবচেয়ে সাধারণ
                    পর্দায় — সাইটের নামটাই উধাও হয়ে যেত, পড়ে থাকত
                    কেবল একটি চিহ্ন। লোগো থেকে নাম সরানো যায় না। */}
                <span className="block">
                  {/* ★ দুই-টোন ওয়ার্ডমার্ক — "SS" অ্যাকসেন্ট রঙে, বাকিটা ink-এ।
                      নতুন ফন্ট বা ছবি ছাড়াই নামটিকে ব্র্যান্ডের মতো দেখায়।
                      ⚠️ অ্যাডমিন নিজের নাম বসালে এটি প্রযোজ্য নয় — তখন তাদের
                      নাম এক রঙেই দেখানো হয় (এটি আমাদের ব্র্যান্ড, তাদের নয়)। */}
                  <span
                    className="v-dsp block text-[15px] font-extrabold uppercase leading-none xs:text-[17px]"
                    style={{ color: 'var(--v-ink)', letterSpacing: '-.02em' }}
                  >
                    {isDefaultBrand(siteName) ? (
                      <>
                        <span style={{ color: 'var(--v-volt)' }}>{BRAND.markPrefix}</span>
                        <span aria-hidden className="mx-[3px] opacity-40">·</span>
                        {BRAND.markRest}
                      </>
                    ) : siteName}
                  </span>
                  <span className="hud hud-wide mt-1 hidden xs:block">
                    {BRAND.tagline.replace(/ /g, ' ')}
                  </span>
                </span>
              </>
            )}
          </Link>

          {/* ── ডেস্কটপ মেনু ──
              ★ breakpoint lg→xl: এই আইটেম-ঘনত্বে ১০২৪px-এ সব এক লাইনে
              আঁটে না (font ছোট না করে)। তাই ≥1280px (xl)-এ পূর্ণ অনুভূমিক
              নেভ, তার নিচে পরিষ্কার হ্যামবার্গার — wrap নয় (req #7,#8)। */}
          <nav className={`hidden items-center gap-0.5 ${navFlex}`} aria-label="প্রধান মেনু">
            {categories.map((c: (typeof categories)[number]) => (
              <Link key={c.id} href={`/#cat-${c.id}`} className="v-nav">
                {c.name}
              </Link>
            ))}
            <Link href="/track" className="v-nav" data-active={path === '/track' ? 'true' : undefined}>
              {t('nav.track')}
            </Link>
            <Link href="/faq" className="v-nav" data-active={path === '/faq' ? 'true' : undefined}>
              {t('nav.faq')}
            </Link>
            <Link href="/contact" className="v-nav" data-active={path === '/contact' ? 'true' : undefined}>
              {t('nav.contact')}
            </Link>
          </nav>

          {/* ── ডেস্কটপ: অ্যাকাউন্ট ── */}
          <div className={`hidden shrink-0 items-center gap-1.5 ${navFlex}`}>
            {authed ? (
              <>
                <Link
                  href="/account/wallet/deposit"
                  className="v-hud inline-flex min-h-[40px] items-center gap-1.5 px-3 text-[13px] font-bold"
                  style={{
                    border: '1px solid rgba(125,211,252,.32)',
                    background: 'rgba(125,211,252,.12)',
                    color: 'var(--v-ice)',
                    borderRadius: 2,
                  }}
                >
                  <span>৳{balance ?? '···'}</span>
                  <span className="text-base leading-none" aria-hidden="true">+</span>
                  <span className="sr-only">ব্যালেন্স — টাকা যোগ করুন</span>
                </Link>

                <div ref={bellRef} className="relative">
                  <button
                    onClick={() => {
                      const next = !bell;
                      setBell(next);
                      if (next && unread > 0) markRead();
                    }}
                    aria-label={`নোটিফিকেশন${unread > 0 ? ` — ${unread}টি নতুন` : ''}`}
                    aria-expanded={bell}
                    className="relative grid h-10 w-10 place-items-center transition-colors"
                    style={{ color: 'var(--v-mut)', borderRadius: 2 }}
                  >
                    <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
                      <path d="M18 8A6 6 0 006 8c0 7-3 9-3 9h18s-3-2-3-9M13.7 21a2 2 0 01-3.4 0" />
                    </svg>
                    {unread > 0 && (
                      <span
                        className="v-hud absolute right-0.5 top-0.5 grid h-4 min-w-[16px] place-items-center px-1 text-[9px] font-bold"
                        style={{ background: '#7c3aed', color: '#fff', borderRadius: 8 }}
                      >
                        {unread > 9 ? '9+' : unread}
                      </span>
                    )}
                  </button>

                  {bell && (
                    <div
                      className="animate-pop absolute right-0 top-full mt-2 w-80 overflow-hidden"
                      style={{
                        background: 'var(--v-steel)',
                        border: '1px solid var(--v-edge2)',
                        borderRadius: 12,
                        boxShadow: '0 20px 50px -12px rgba(0,0,0,.6)',
                      }}
                    >
                      <div
                        className="flex items-center justify-between px-4 py-3"
                        style={{ borderBottom: '1px solid var(--v-edge)' }}
                      >
                        <p className="hud">নোটিফিকেশন</p>
                        <Link
                          href="/account/notifications"
                          onClick={() => setBell(false)}
                          className="text-xs font-semibold hover:underline"
                          style={{ color: 'var(--v-ice)' }}
                        >
                          সব দেখুন
                        </Link>
                      </div>
                      <div className="max-h-80 overflow-y-auto">
                        {notifs.length === 0 ? (
                          <p className="px-4 py-8 text-center text-sm" style={{ color: 'var(--v-mut)' }}>
                            কোনো নোটিফিকেশন নেই
                          </p>
                        ) : (
                          notifs.map((n: (typeof notifs)[number]) => {
                            const body = (
                              <>
                                <p className="text-sm font-semibold" style={{ color: 'var(--v-ink)' }}>{n.title}</p>
                                <p className="mt-0.5 text-xs leading-relaxed" style={{ color: 'var(--v-mut)' }}>{n.body}</p>
                                <p className="v-hud mt-1.5 text-[10px]" style={{ color: 'var(--v-dim)' }}>
                                  {fmtShort(n.createdAt)}
                                </p>
                              </>
                            );
                            return n.link ? (
                              <Link
                                key={n.id} href={n.link}
                                onClick={() => setBell(false)}
                                className="block px-4 py-3 transition-colors hover:bg-[rgba(255,255,255,.06)]"
                                style={{ borderBottom: '1px solid var(--v-edge)' }}
                              >
                                {body}
                              </Link>
                            ) : (
                              <div key={n.id} className="px-4 py-3" style={{ borderBottom: '1px solid var(--v-edge)' }}>
                                {body}
                              </div>
                            );
                          })
                        )}
                      </div>
                    </div>
                  )}
                </div>

                <Link href="/account/orders" className="v-nav">{t('nav.orders')}</Link>
                {/* ⚠️ এই লিংকটি আগেও ছিল — সরানো হয়নি (CLAUDE.md §18)।
                    কেবল লেবেলটি স্পষ্ট করা হয়েছে: "SMM" গ্রাহকের কাছে
                    অর্থহীন শব্দ, যেখানে জিনিসটি আসলে সাবস্ক্রিপশন। */}
                <Link href="/account/smm-orders" className="v-nav">সাবস্ক্রিপশন</Link>
                <Link href="/account" className="v-nav">{t('nav.account')}</Link>

                {isAdmin && (
                  <Link
                    href="/admin"
                    className="v-hud inline-flex min-h-[40px] items-center px-3 text-[13px] font-bold"
                    style={{ background: '#7c3aed', color: '#fff', borderRadius: 8 }}
                  >
                    {t('nav.admin')}
                  </Link>
                )}

                <ThemeToggle />
                <LanguageToggle />

                <button
                  onClick={() => signOut({ callbackUrl: '/' })}
                  className="inline-flex min-h-[40px] items-center px-3 text-sm transition-colors hover:text-[color:var(--v-ink)]"
                  style={{ color: 'var(--v-mut)' }}
                >
                  {t('nav.logout')}
                </button>
              </>
            ) : (
              <>
                <ThemeToggle />
                <LanguageToggle />
                <Link href="/login" className="v-nav">{t('nav.login')}</Link>
                <Link href="/register" className="v-btn v-btn--volt" style={{ minHeight: 42 }}>
                  {t('nav.register')}
                </Link>
              </>
            )}
          </div>

          {/* ── মোবাইল / ছোট-ল্যাপটপ ── */}
          <div className={`flex items-center gap-2 ${navHidden}`}>
            {authed && (
              <Link
                href="/account/wallet/deposit"
                className="v-hud inline-flex min-h-[40px] items-center px-3 text-xs font-bold"
                style={{
                  border: '1px solid rgba(125,211,252,.32)',
                  background: 'rgba(125,211,252,.12)',
                  color: 'var(--v-ice)',
                  borderRadius: 2,
                }}
              >
                ৳{balance ?? '···'}
              </Link>
            )}
            <button
              onClick={() => setMenu(!menu)}
              aria-label={menu ? 'মেনু বন্ধ করুন' : 'মেনু খুলুন'}
              aria-expanded={menu}
              className="grid h-11 w-11 place-items-center transition-colors"
              style={{ color: 'var(--v-ink)', border: '1px solid var(--v-edge)', borderRadius: 2 }}
            >
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                {menu ? <path d="M18 6L6 18M6 6l12 12" /> : <path d="M3 6h18M3 12h18M3 18h18" />}
              </svg>
            </button>
          </div>
        </div>

        {menu && (
          <nav
            className={`stagger space-y-1 pb-4 pt-3 ${navHidden}`}
            style={{ borderTop: '1px solid var(--v-edge)' }}
            aria-label="মোবাইল মেনু"
          >
            <p className="hud-mut hud px-1 pb-2 pt-1">ক্যাটাগরি</p>
            {categories.map((c: (typeof categories)[number]) => (
              <Link
                key={c.id}
                href={`/#cat-${c.id}`}
                onClick={() => setMenu(false)}
                className="v-hud flex min-h-[46px] items-center px-3 text-sm font-bold uppercase tracking-wide transition-colors hover:bg-[rgba(255,255,255,.06)]"
                style={{ color: 'var(--v-ink)', borderRadius: 2 }}
              >
                {c.name}
              </Link>
            ))}

            <div className="flex items-center justify-between px-1 pb-1 pt-3">
              <p className="hud-mut hud">থিম / Theme</p>
              <ThemeToggle compact />
            </div>
            <div className="flex items-center justify-between px-1 pb-1 pt-2">
              <p className="hud-mut hud">অ্যাকসেন্ট / Accent</p>
              <AccentPicker />
            </div>
            <div className="flex items-center justify-between px-1 pb-1 pt-2">
              <p className="hud-mut hud">ভাষা / Language</p>
              <LanguageToggle compact />
            </div>

            <p className="hud-mut hud px-1 pb-2 pt-3">সাহায্য</p>
            {[
              { href: '/track', label: 'অর্ডার ট্র্যাক করুন' },
              { href: '/faq', label: 'সাধারণ প্রশ্ন' },
              { href: '/contact', label: 'যোগাযোগ' },
            ].map((l) => (
              <Link
                key={l.href}
                href={l.href}
                onClick={() => setMenu(false)}
                className="flex min-h-[46px] items-center px-3 text-sm transition-colors hover:bg-[rgba(255,255,255,.06)]"
                style={{ color: 'var(--v-mut)', borderRadius: 2 }}
              >
                {l.label}
              </Link>
            ))}

            {authed ? (
              <>
                <p className="hud-mut hud px-1 pb-2 pt-3">অ্যাকাউন্ট</p>
                <Link
                  href="/account/wallet/deposit"
                  onClick={() => setMenu(false)}
                  className="v-hud flex min-h-[46px] items-center px-3 text-sm font-bold"
                  style={{ background: 'rgba(125,211,252,.12)', color: 'var(--v-ice)', borderRadius: 8 }}
                >
                  ব্যালেন্স ৳{balance ?? '···'} — টাকা যোগ করুন
                </Link>
                <Link href="/account/orders" onClick={() => setMenu(false)} className="flex min-h-[46px] items-center justify-between px-3 text-sm transition-colors hover:bg-[rgba(255,255,255,.06)]" style={{ color: 'var(--v-mut)', borderRadius: 2 }}>
                  <span>আমার অর্ডার</span>
                  {unread > 0 && (
                    <span className="v-hud px-1.5 py-0.5 text-[10px] font-bold" style={{ background: '#7c3aed', color: '#fff', borderRadius: 8 }}>{unread}</span>
                  )}
                </Link>
                <Link href="/account/smm-orders" onClick={() => setMenu(false)} className="flex min-h-[46px] items-center px-3 text-sm transition-colors hover:bg-[rgba(255,255,255,.06)]" style={{ color: 'var(--v-mut)', borderRadius: 2 }}>
                  সাবস্ক্রিপশন অর্ডার
                </Link>
                <Link href="/account" onClick={() => setMenu(false)} className="flex min-h-[46px] items-center px-3 text-sm transition-colors hover:bg-[rgba(255,255,255,.06)]" style={{ color: 'var(--v-mut)', borderRadius: 2 }}>
                  প্রোফাইল ও রেফারেল
                </Link>
                <Link href="/account/profile" onClick={() => setMenu(false)} className="flex min-h-[46px] items-center px-3 text-sm transition-colors hover:bg-[rgba(255,255,255,.06)]" style={{ color: 'var(--v-mut)', borderRadius: 2 }}>
                  তথ্য ও পাসওয়ার্ড
                </Link>
                <Link href="/account/notifications" onClick={() => setMenu(false)} className="flex min-h-[46px] items-center px-3 text-sm transition-colors hover:bg-[rgba(255,255,255,.06)]" style={{ color: 'var(--v-mut)', borderRadius: 2 }}>
                  নোটিফিকেশন
                </Link>
                {isAdmin && (
                  <Link href="/admin" onClick={() => setMenu(false)} className="v-hud flex min-h-[46px] items-center px-3 text-sm font-bold" style={{ background: '#7c3aed', color: '#fff', borderRadius: 8 }}>
                    অ্যাডমিন প্যানেল
                  </Link>
                )}
                <button
                  onClick={() => signOut({ callbackUrl: '/' })}
                  className="flex min-h-[46px] w-full items-center px-3 text-left text-sm transition-colors hover:bg-[rgba(255,255,255,.06)]"
                  style={{ color: 'var(--v-volt)', borderRadius: 2 }}
                >
                  লগআউট
                </button>
              </>
            ) : (
              <div className="flex gap-2 pt-4">
                <Link href="/login" onClick={() => setMenu(false)} className="v-btn v-btn--ghost flex-1">লগইন</Link>
                <Link href="/register" onClick={() => setMenu(false)} className="v-btn v-btn--volt flex-1">শুরু করুন</Link>
              </div>
            )}
          </nav>
        )}
      </div>
    </header>
  );
}
