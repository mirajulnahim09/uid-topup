'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import Badge from '@/components/Badge';
import OrderTimeline from '@/components/OrderTimeline';
import SlaCountdown from '@/components/SlaCountdown';

type TrackedOrder = {
  orderNo: number;
  productName: string;
  variantName: string;
  playerUidMasked: string;
  price: string;
  status: string;
  adminNote: string | null;
  createdAt: string;
  completedAt: string | null;
  slaDueAt: string | null;
  slaText: string;
  events: { status: string; note: string | null; at: string }[];
};

/**
 * ★ অর্ডার ট্র্যাকিং ফর্ম — লগইন ছাড়া।
 *
 *   দুটি পথ সমর্থিত:
 *     • ?t=<token> লিংক দিয়ে সরাসরি
 *     • অর্ডার নাম্বার + ফোন/ইমেইল
 *
 *   ⚠️ Player UID ঢাকা অবস্থায় আসে (সার্ভার থেকেই) — এই
 *      কম্পোনেন্ট কখনো সম্পূর্ণ UID পায়ই না।
 */
export default function TrackForm({ initialToken }: { initialToken: string }) {
  const [orderNo, setOrderNo] = useState('');
  const [contact, setContact] = useState('');
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState('');
  const [order, setOrder] = useState<TrackedOrder | null>(null);

  const lookup = useCallback(async (payload: Record<string, unknown>) => {
    setLoading(true);
    setErr('');
    try {
      const res = await fetch('/api/track', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const d = await res.json();
      if (!res.ok) throw new Error(d.error || 'খুঁজে পাওয়া যায়নি');
      setOrder(d.order);
    } catch (e) {
      setOrder(null);
      setErr(e instanceof Error ? e.message : 'খুঁজে পাওয়া যায়নি');
    } finally {
      setLoading(false);
    }
  }, []);

  // ★ লিংকে টোকেন থাকলে সাথে সাথেই দেখাই
  useEffect(() => {
    if (initialToken) lookup({ token: initialToken });
  }, [initialToken, lookup]);

  return (
    <div className="space-y-5">
      {!initialToken && (
        <form
          className="card space-y-4 p-5"
          onSubmit={(e) => {
            e.preventDefault();
            lookup({ orderNo: Number(orderNo), contact });
          }}
        >
          <div>
            <label htmlFor="trk-no" className="label">অর্ডার নাম্বার</label>
            <input
              id="trk-no"
              className="input"
              inputMode="numeric"
              placeholder="যেমন: 1043"
              value={orderNo}
              onChange={(e) => setOrderNo(e.target.value.replace(/\D/g, ''))}
              required
            />
          </div>

          <div>
            <label htmlFor="trk-contact" className="label">ফোন নাম্বার বা ইমেইল</label>
            <input
              id="trk-contact"
              className="input"
              placeholder="01XXXXXXXXX বা you@example.com"
              value={contact}
              onChange={(e) => setContact(e.target.value)}
              required
            />
            <p className="mt-1.5 text-[11px]" style={{ color: 'var(--mut)' }}>
              অর্ডার করার সময় যেটি ব্যবহার করেছিলেন
            </p>
          </div>

          <button
            type="submit"
            disabled={loading || !orderNo || !contact.trim()}
            className="btn-primary w-full py-3 text-sm font-bold disabled:opacity-50"
          >
            {loading ? 'খোঁজা হচ্ছে…' : 'অবস্থা দেখুন'}
          </button>
        </form>
      )}

      {loading && initialToken && <div className="skeleton h-32 w-full" />}

      {err && (
        <div className="alert-error" role="alert">
          {err}
        </div>
      )}

      {order && (
        <div className="space-y-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h2 className="dsp text-xl font-medium" style={{ color: 'var(--ink)' }}>
              অর্ডার <span className="font-mono" style={{ color: 'var(--gold)' }}>#{order.orderNo}</span>
            </h2>
            <Badge status={order.status} />
          </div>

          <OrderTimeline
            status={order.status}
            createdAt={order.createdAt}
            completedAt={order.completedAt}
            events={order.events}
          />

          <section className="card p-5">
            <dl className="space-y-3 text-sm">
              <div className="flex justify-between gap-3">
                <dt style={{ color: 'var(--mut)' }}>প্রোডাক্ট</dt>
                <dd className="text-right font-semibold" style={{ color: 'var(--ink)' }}>
                  {order.productName}
                </dd>
              </div>
              <div className="flex justify-between gap-3">
                <dt style={{ color: 'var(--mut)' }}>প্যাকেজ</dt>
                <dd className="text-right font-semibold" style={{ color: 'var(--gold)' }}>
                  {order.variantName}
                </dd>
              </div>
              <div className="flex justify-between gap-3">
                <dt style={{ color: 'var(--mut)' }}>Player UID</dt>
                {/* ★ ঢাকা — নিজের অর্ডার চেনার জন্য যথেষ্ট */}
                <dd className="text-right font-mono" style={{ color: 'var(--ink)' }}>
                  {order.playerUidMasked}
                </dd>
              </div>
              <div className="flex justify-between gap-3">
                <dt style={{ color: 'var(--mut)' }}>মূল্য</dt>
                <dd className="text-right font-bold" style={{ color: 'var(--ink)' }}>
                  ৳{order.price}
                </dd>
              </div>
            </dl>
          </section>

          {(order.status === 'PENDING' ||
            order.status === 'PROCESSING' ||
            order.status === 'AWAITING_PAYMENT') && (
            <div className="card p-5">
              <p className="text-sm leading-relaxed" style={{ color: 'var(--ink)' }}>
                ⏳ {order.slaText}
              </p>
              {order.slaDueAt && (
                <div className="mt-3">
                  <SlaCountdown dueAt={order.slaDueAt} />
                </div>
              )}
            </div>
          )}

          {order.adminNote && (
            <div className="card p-5">
              <p className="mb-1 text-xs font-bold" style={{ color: 'var(--gold)' }}>
                নোট
              </p>
              <p className="whitespace-pre-line text-sm leading-relaxed" style={{ color: 'var(--mut)' }}>
                {order.adminNote}
              </p>
            </div>
          )}

          <div className="flex flex-wrap gap-3">
            <Link href="/account/orders" className="btn-ghost px-5 text-sm">
              সব অর্ডার দেখুন
            </Link>
            <Link href="/contact" className="btn-ghost px-5 text-sm">
              সাপোর্টে যোগাযোগ
            </Link>
          </div>
        </div>
      )}
    </div>
  );
}
