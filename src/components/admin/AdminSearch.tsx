'use client';

import { useState, useRef, useEffect, useCallback } from 'react';
import Link from 'next/link';
import Badge from '@/components/Badge';
import { bdt } from '@/lib/money';
import { fmtDate } from '@/lib/date';

type Results = {
  orders: Array<{
    id: string; orderNo: number; status: string; price: number; playerUid: string;
    productName: string; variantName: string; createdAt: string;
    userId: string; userName: string;
  }>;
  deposits: Array<{
    id: string; depositNo: number; status: string; amount: number; trxId: string;
    method: string; senderNo: string; createdAt: string;
    userId: string; userName: string;
  }>;
  users: Array<{
    id: string; name: string; email: string; phone: string; balance: number;
    isBanned: boolean; status: string; orderCount: number; depositCount: number;
  }>;
};

/**
 * ★ সর্বজনীন অ্যাডমিন সার্চ (3.2)
 *
 *   গ্রাহকের মেসেজ থেকে যা-ই পেস্ট করা হোক — অর্ডার নাম্বার,
 *   TrxID, ফোন, UID, নাম — একটিই বাক্সে উত্তর মেলে
 *   (MANUAL_WORKFLOW.md B3)।
 */
export default function AdminSearch() {
  const [q, setQ] = useState('');
  const [res, setRes] = useState<Results | null>(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState('');
  const [open, setOpen] = useState(false);
  const boxRef = useRef<HTMLDivElement>(null);

  // ★ বাইরে ক্লিক করলে ফলাফল বন্ধ
  useEffect(() => {
    function onDoc(e: MouseEvent) {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, []);

  const search = useCallback(async (term: string) => {
    const t = term.trim();
    // ★ এক-অঙ্কের সংখ্যা চলবে (অর্ডার/ডিপোজিট নাম্বার), টেক্সটে ২+
    if (t.length === 0 || (t.length < 2 && !/^\d$/.test(t))) {
      setRes(null);
      setErr('');
      return;
    }
    setLoading(true);
    setErr('');
    try {
      const r = await fetch('/api/admin/search', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ q: term.trim() }),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || 'খোঁজা যায়নি');
      setRes(d);
      setOpen(true);
    } catch (e) {
      setRes(null);
      setErr(e instanceof Error ? e.message : 'খোঁজা যায়নি');
    } finally {
      setLoading(false);
    }
  }, []);

  // ★ debounce — প্রতিটি অক্ষরে query পাঠানো হয় না
  useEffect(() => {
    const t = setTimeout(() => search(q), 350);
    return () => clearTimeout(t);
  }, [q, search]);

  const total =
    (res?.orders.length ?? 0) + (res?.deposits.length ?? 0) + (res?.users.length ?? 0);

  return (
    <div ref={boxRef} className="relative">
      <label htmlFor="admin-search" className="sr-only">
        অর্ডার, ডিপোজিট, গ্রাহক — সব খুঁজুন
      </label>
      <input
        id="admin-search"
        className="input"
        placeholder="অর্ডার নং, TrxID, ফোন, UID, নাম…"
        value={q}
        onChange={(e) => setQ(e.target.value)}
        onFocus={() => res && setOpen(true)}
        autoComplete="off"
      />

      {loading && (
        <span
          className="absolute right-3 top-1/2 -translate-y-1/2 text-xs"
          style={{ color: 'var(--mut)' }}
        >
          খোঁজা হচ্ছে…
        </span>
      )}

      {err && (
        <p className="mt-1.5 text-xs" style={{ color: 'var(--red)' }} role="alert">
          {err}
        </p>
      )}

      {open && res && (
        <div
          className="card absolute left-0 right-0 top-full z-50 mt-2 max-h-[70vh] overflow-y-auto p-2"
          role="region"
          aria-label="সার্চ ফলাফল"
        >
          {total === 0 && (
            <p className="p-4 text-center text-sm" style={{ color: 'var(--mut)' }}>
              কিছু পাওয়া যায়নি
            </p>
          )}

          {res.users.length > 0 && (
            <Section title="গ্রাহক">
              {res.users.map((u) => (
                <Link
                  key={u.id}
                  href={`/admin/users/${u.id}`}
                  onClick={() => setOpen(false)}
                  className="block rounded-lg px-3 py-2.5 transition hover:bg-white/5"
                >
                  <div className="flex items-baseline justify-between gap-3">
                    <span className="truncate text-sm font-semibold" style={{ color: 'var(--ink)' }}>
                      {u.name}
                      {u.isBanned && (
                        <span className="ml-2 text-[10px]" style={{ color: 'var(--red)' }}>
                          ব্যানড
                        </span>
                      )}
                    </span>
                    <span className="shrink-0 text-xs font-bold" style={{ color: 'var(--gold)' }}>
                      {bdt(u.balance)}
                    </span>
                  </div>
                  <p className="truncate text-[11px]" style={{ color: 'var(--mut)' }}>
                    {u.phone} · {u.email} · {u.orderCount} অর্ডার · {u.depositCount} ডিপোজিট
                  </p>
                </Link>
              ))}
            </Section>
          )}

          {res.deposits.length > 0 && (
            <Section title="ডিপোজিট">
              {res.deposits.map((d) => (
                <Link
                  key={d.id}
                  href={`/admin/users/${d.userId}`}
                  onClick={() => setOpen(false)}
                  className="block rounded-lg px-3 py-2.5 transition hover:bg-white/5"
                >
                  <div className="flex items-baseline justify-between gap-3">
                    <span className="truncate text-sm font-semibold" style={{ color: 'var(--ink)' }}>
                      <span className="font-mono" style={{ color: 'var(--gold)' }}>#{d.depositNo}</span>{' '}
                      {d.userName}
                    </span>
                    <Badge status={d.status} />
                  </div>
                  <p className="truncate text-[11px]" style={{ color: 'var(--mut)' }}>
                    <span className="font-mono">{d.trxId}</span> · {d.method} · {bdt(d.amount)} ·{' '}
                    {fmtDate(d.createdAt)}
                  </p>
                </Link>
              ))}
            </Section>
          )}

          {res.orders.length > 0 && (
            <Section title="অর্ডার">
              {res.orders.map((o) => (
                <Link
                  key={o.id}
                  href={`/admin/users/${o.userId}`}
                  onClick={() => setOpen(false)}
                  className="block rounded-lg px-3 py-2.5 transition hover:bg-white/5"
                >
                  <div className="flex items-baseline justify-between gap-3">
                    <span className="truncate text-sm font-semibold" style={{ color: 'var(--ink)' }}>
                      <span className="font-mono" style={{ color: 'var(--gold)' }}>#{o.orderNo}</span>{' '}
                      {o.productName}
                    </span>
                    <Badge status={o.status} />
                  </div>
                  <p className="truncate text-[11px]" style={{ color: 'var(--mut)' }}>
                    {o.variantName} · UID <span className="font-mono">{o.playerUid}</span> ·{' '}
                    {bdt(o.price)} · {o.userName}
                  </p>
                </Link>
              ))}
            </Section>
          )}
        </div>
      )}
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="mb-1">
      <p
        className="px-3 pb-1 pt-2 text-[10px] font-semibold uppercase"
        style={{ letterSpacing: '.16em', color: 'var(--gold)' }}
      >
        {title}
      </p>
      {children}
    </div>
  );
}
