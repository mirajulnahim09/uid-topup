'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useSession, signOut } from 'next-auth/react';
import { useCallback, useEffect, useRef, useState } from 'react';

type N = {
  id: string; title: string; body: string;
  link: string | null; isRead: boolean; createdAt: string;
};
type Cat = { id: number; name: string };

export default function Navbar({
  siteName = 'UID TopUp',
  logo,
  categories = [],
}: {
  siteName?: string;
  logo?: string | null;
  categories?: Cat[];
}) {
  const { data: session, status } = useSession();
  const path = usePathname();

  const [balance, setBalance] = useState<string | null>(null);
  const [menu, setMenu] = useState(false);
  const [bell, setBell] = useState(false);
  const [notifs, setNotifs] = useState<N[]>([]);
  const [unread, setUnread] = useState(0);

  const bellRef = useRef<HTMLDivElement>(null);
  const authed = status === 'authenticated';
  const isAdmin = session?.user?.role === 'ADMIN';

  const load = useCallback(async () => {
    if (status !== 'authenticated') return;
    try {
      const [me, nt] = await Promise.all([fetch('/api/me'), fetch('/api/notifications')]);
      if (me.ok) setBalance((await me.json()).balance);
      if (nt.ok) {
        const d = await nt.json();
        setNotifs(d.items);
        setUnread(d.unread);
      }
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
    try { await fetch('/api/notifications', { method: 'PATCH' }); } catch { /* */ }
  }

  return (
    <header className="sticky top-0 z-40 backdrop-blur-xl" style={{ background: 'linear-gradient(180deg,rgba(7,5,18,.92),rgba(7,5,18,.55))', borderBottom: '1px solid var(--line)' }}>
      <div aria-hidden="true" className="absolute inset-x-0 top-0 h-px" style={{ background: 'linear-gradient(90deg,transparent,#ff2d78,#22e0ee,#8b5cf6,transparent)' }} />
      <div className="mx-auto max-w-7xl px-4">
        <div className="flex h-16 items-center justify-between gap-3">
          {/* Logo */}
          <Link href="/" className="flex shrink-0 items-center gap-2" aria-label={siteName}>
            {logo ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={logo} alt={siteName} className="h-11 w-auto" />
            ) : (
              <>
                <div
                  className="grid h-10 w-10 place-items-center rounded-xl bg-gradient-to-br from-[#8b5cf6] to-[#ff2d78] text-lg font-black text-white shadow-[0_0_20px_rgba(255,45,120,0.5)]"
                  aria-hidden="true"
                >
                  {siteName.charAt(0).toUpperCase()}
                </div>
                <div className="hidden xs:block">
                  <span className="block text-lg font-extrabold uppercase leading-tight tracking-tight text-slate-900">
                    {siteName}
                  </span>
                  <span className="block text-[10px] font-semibold text-rose-600">
                    কম দামে ভালো সার্ভিস
                  </span>
                </div>
              </>
            )}
          </Link>

          {/* ── Desktop: ক্যাটাগরি নাম (uidtopup স্টাইল) ── */}
          <nav className="hidden items-center gap-1 lg:flex" aria-label="প্রধান মেনু">
            {categories.map((c: (typeof categories)[number]) => (
              <Link
                key={c.id}
                href={`/#cat-${c.id}`}
                className="rounded-lg px-3 py-2 text-sm font-bold uppercase tracking-wide text-slate-600 transition hover:bg-[rgba(139,92,246,0.18)] hover:text-white"
              >
                {c.name}
              </Link>
            ))}
            <Link
              href="/faq"
              className="rounded-lg px-3 py-2 text-sm font-bold uppercase tracking-wide text-slate-600 transition hover:bg-[rgba(139,92,246,0.18)] hover:text-white"
            >
              সাহায্য
            </Link>
            <Link
              href="/contact"
              className="rounded-lg px-3 py-2 text-sm font-bold uppercase tracking-wide text-slate-600 transition hover:bg-[rgba(139,92,246,0.18)] hover:text-white"
            >
              যোগাযোগ
            </Link>
          </nav>

          {/* ── Desktop: auth ── */}
          <div className="hidden items-center gap-2 lg:flex">
            {authed ? (
              <>
                <Link
                  href="/account/wallet/deposit"
                  className="flex items-center gap-1.5 rounded-lg border border-[rgba(16,185,129,0.4)] bg-[rgba(16,185,129,0.14)] px-3 py-2 text-sm font-bold text-emerald-300 transition hover:bg-[rgba(16,185,129,0.24)]"
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
                    className="relative rounded-lg p-2 text-slate-500 transition hover:bg-slate-100 hover:text-slate-900"
                  >
                    <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
                      <path d="M18 8A6 6 0 006 8c0 7-3 9-3 9h18s-3-2-3-9M13.7 21a2 2 0 01-3.4 0" />
                    </svg>
                    {unread > 0 && (
                      <span className="absolute right-1 top-1 grid h-4 min-w-[16px] place-items-center rounded-full bg-rose-500 px-1 text-[9px] font-bold text-white">
                        {unread > 9 ? '9+' : unread}
                      </span>
                    )}
                  </button>

                  {bell && (
                    <div className="animate-pop absolute right-0 top-full mt-2 w-80 overflow-hidden rounded-xl border border-[rgba(139,92,246,0.24)] bg-[#120e28] shadow-2xl">
                      <div className="flex items-center justify-between border-b border-slate-100 px-4 py-2.5">
                        <p className="text-sm font-bold text-slate-900">নোটিফিকেশন</p>
                        <Link
                          href="/account/notifications"
                          onClick={() => setBell(false)}
                          className="text-xs font-semibold text-rose-600 hover:underline"
                        >
                          সব দেখুন
                        </Link>
                      </div>
                      <div className="max-h-80 overflow-y-auto">
                        {notifs.length === 0 ? (
                          <p className="px-4 py-8 text-center text-sm text-slate-400">
                            কোনো নোটিফিকেশন নেই
                          </p>
                        ) : (
                          notifs.map((n: (typeof notifs)[number]) => {
                            const body = (
                              <>
                                <p className="text-sm font-semibold text-slate-900">{n.title}</p>
                                <p className="mt-0.5 text-xs leading-relaxed text-slate-500">{n.body}</p>
                                <p className="mt-1 text-[10px] text-slate-400">
                                  {new Date(n.createdAt).toLocaleString('en-GB', {
                                    day: '2-digit', month: 'short',
                                    hour: '2-digit', minute: '2-digit', hour12: true,
                                  })}
                                </p>
                              </>
                            );
                            return n.link ? (
                              <Link
                                key={n.id} href={n.link}
                                onClick={() => setBell(false)}
                                className="block border-b border-slate-100 px-4 py-3 transition last:border-0 hover:bg-slate-50"
                              >
                                {body}
                              </Link>
                            ) : (
                              <div key={n.id} className="border-b border-slate-100 px-4 py-3 last:border-0">
                                {body}
                              </div>
                            );
                          })
                        )}
                      </div>
                    </div>
                  )}
                </div>

                <Link href="/account/orders" className="rounded-lg px-3 py-2 text-sm font-semibold text-slate-600 transition hover:bg-slate-100">
                  অর্ডার
                </Link>
                <Link href="/account/smm-orders" className="rounded-lg px-3 py-2 text-sm font-semibold text-slate-600 transition hover:bg-slate-100">
                  SMM অর্ডার
                </Link>
                <Link href="/account" className="rounded-lg px-3 py-2 text-sm font-semibold text-slate-600 transition hover:bg-slate-100">
                  প্রোফাইল
                </Link>

                {isAdmin && (
                  <Link href="/admin" className="rounded-lg bg-gradient-to-r from-[#8b5cf6] to-[#ff2d78] px-3 py-2 text-sm font-bold text-white transition hover:brightness-110">
                    অ্যাডমিন
                  </Link>
                )}

                <button
                  onClick={() => signOut({ callbackUrl: '/' })}
                  className="rounded-lg px-3 py-2 text-sm text-slate-500 transition hover:bg-slate-100 hover:text-rose-600"
                >
                  লগআউট
                </button>
              </>
            ) : (
              <>
                <Link href="/register" className="btn-ghost">Register</Link>
                <Link href="/login" className="btn-dark px-6">Login</Link>
              </>
            )}
          </div>

          {/* ── Mobile ── */}
          <div className="flex items-center gap-2 lg:hidden">
            {authed && (
              <Link
                href="/account/wallet/deposit"
                className="rounded-lg border border-[rgba(16,185,129,0.4)] bg-[rgba(16,185,129,0.14)] px-2.5 py-1.5 text-xs font-bold text-emerald-300"
              >
                ৳{balance ?? '···'}
              </Link>
            )}
            <button
              onClick={() => setMenu(!menu)}
              aria-label={menu ? 'মেনু বন্ধ করুন' : 'মেনু খুলুন'}
              aria-expanded={menu}
              className="rounded-lg p-2 text-slate-600 transition hover:bg-slate-100"
            >
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                {menu ? <path d="M18 6L6 18M6 6l12 12" /> : <path d="M3 6h18M3 12h18M3 18h18" />}
              </svg>
            </button>
          </div>
        </div>

        {menu && (
          <nav className="space-y-1 border-t border-slate-200 py-3 lg:hidden" aria-label="মোবাইল মেনু">
            {categories.map((c: (typeof categories)[number]) => (
              <Link
                key={c.id}
                href={`/#cat-${c.id}`}
                onClick={() => setMenu(false)}
                className="block rounded-lg px-3 py-3 text-sm font-bold uppercase hover:bg-slate-100"
              >
                {c.name}
              </Link>
            ))}
            <Link href="/faq" onClick={() => setMenu(false)} className="block rounded-lg px-3 py-3 text-sm font-semibold hover:bg-slate-100">
              সাহায্য
            </Link>

            {authed ? (
              <>
                <Link
                  href="/account/wallet/deposit"
                  onClick={() => setMenu(false)}
                  className="block rounded-lg bg-[rgba(16,185,129,0.14)] px-3 py-3 text-sm font-bold text-emerald-300"
                >
                  ব্যালেন্স ৳{balance ?? '···'} — Add Money
                </Link>
                <Link href="/account/orders" onClick={() => setMenu(false)} className="flex items-center justify-between rounded-lg px-3 py-3 text-sm hover:bg-slate-100">
                  <span>আমার অর্ডার</span>
                  {unread > 0 && (
                    <span className="rounded-full bg-rose-500 px-1.5 py-0.5 text-[10px] font-bold text-white">{unread}</span>
                  )}
                </Link>
                <Link href="/account/smm-orders" onClick={() => setMenu(false)} className="block rounded-lg px-3 py-3 text-sm hover:bg-slate-100">
                  SMM অর্ডার
                </Link>
                <Link href="/account" onClick={() => setMenu(false)} className="block rounded-lg px-3 py-3 text-sm hover:bg-slate-100">
                  প্রোফাইল ও রেফারেল
                </Link>
                <Link href="/account/profile" onClick={() => setMenu(false)} className="block rounded-lg px-3 py-3 text-sm hover:bg-slate-100">
                  তথ্য ও পাসওয়ার্ড
                </Link>
                <Link href="/account/notifications" onClick={() => setMenu(false)} className="block rounded-lg px-3 py-3 text-sm hover:bg-slate-100">
                  নোটিফিকেশন
                </Link>
                {isAdmin && (
                  <Link href="/admin" onClick={() => setMenu(false)} className="block rounded-lg bg-gradient-to-r from-[#8b5cf6] to-[#ff2d78] px-3 py-3 text-sm font-bold text-white">
                    অ্যাডমিন প্যানেল
                  </Link>
                )}
                <button
                  onClick={() => signOut({ callbackUrl: '/' })}
                  className="block w-full rounded-lg px-3 py-3 text-left text-sm text-rose-600 hover:bg-slate-100"
                >
                  লগআউট
                </button>
              </>
            ) : (
              <div className="flex gap-2 pt-1">
                <Link href="/register" onClick={() => setMenu(false)} className="btn-ghost flex-1">Register</Link>
                <Link href="/login" onClick={() => setMenu(false)} className="btn-dark flex-1">Login</Link>
              </div>
            )}
          </nav>
        )}
      </div>
    </header>
  );
}
