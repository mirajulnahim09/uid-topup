'use client';

import Link from 'next/link';
import { useState, useTransition } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useToast, ConfirmDialog } from '@/components/Toast';
import { fmtDate } from '@/lib/date';

type U = {
  id: string; name: string; email: string; phone: string;
  role: string; balance: number; isBanned: boolean; status: string;
  referralCode: string; createdAt: string;
  orders: number; deposits: number; referrals: number;
};

export default function UserTable({ users, q }: { users: U[]; q: string }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const params = useSearchParams();
  const toast = useToast();

  const [search, setSearch] = useState(q);
  const [busy, setBusy] = useState<string | null>(null);
  const [adjust, setAdjust] = useState<U | null>(null);
  const [ban, setBan] = useState<U | null>(null);
  const [amount, setAmount] = useState('');
  const [note, setNote] = useState('');
  // ★ idempotency — এক ডায়ালগ-বিষয়বস্তু = এক সমন্বয় (`api/admin/user` দেখুন)।
  //   ব্যর্থ হলে একই গ্রাহকে আবার খুললে একই key ও মান ফিরে আসে, তাই প্রথমটি
  //   আসলে পৌঁছে থাকলে সার্ভার দ্বিতীয়বার যোগ করে না; মান বদলালে নতুন key।
  const [adjustKey, setAdjustKey] = useState('');
  const [adjustFor, setAdjustFor] = useState('');

  function doSearch(e: React.FormEvent) {
    e.preventDefault();
    const p = new URLSearchParams(params.toString());
    if (search.trim()) p.set('q', search.trim());
    else p.delete('q');
    router.push(`/admin/users?${p.toString()}`);
  }

  function openAdjust(u: U) {
    if (!(adjustKey && adjustFor === u.id)) {
      setAmount('');
      setNote('');
      setAdjustKey(crypto.randomUUID());
      setAdjustFor(u.id);
    }
    setAdjust(u);
  }

  async function runAdjust() {
    if (!adjust) return;

    const amt = Number(amount);
    if (isNaN(amt) || amt === 0) return toast.error('সঠিক পরিমাণ দিন (+ যোগ, − বিয়োগ)');
    if (!note.trim()) return toast.error('কারণ লিখুন');

    const u = adjust;
    setAdjust(null);
    setBusy(u.id);

    try {
      const res = await fetch('/api/admin/user', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: u.id, amount: amt, note: note.trim(), requestId: adjustKey || undefined }),
      });
      const d = await res.json();
      if (!res.ok) throw new Error(d.error);

      toast.success(
        d.duplicate
          ? `এই সমন্বয় আগেই হয়ে গেছে — আবার যোগ করা হয়নি (ব্যালেন্স ৳${d.balance})`
          : `${u.name} — ${amt > 0 ? '+' : ''}৳${amt.toFixed(2)} (নতুন ব্যালেন্স ৳${d.balance})`
      );
      setAdjustKey('');
      setAdjustFor('');
      startTransition(() => router.refresh());
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'সমন্বয় করা যায়নি');
    } finally {
      setBusy(null);
    }
  }

  async function runBan() {
    if (!ban) return;
    const u = ban;
    setBan(null);
    setBusy(u.id);

    try {
      const res = await fetch('/api/admin/user', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: u.id, isBanned: !u.isBanned }),
      });
      const d = await res.json();
      if (!res.ok) throw new Error(d.error);

      toast.success(u.isBanned ? `${u.name} আনব্যান করা হয়েছে` : `${u.name} ব্যান করা হয়েছে`);
      startTransition(() => router.refresh());
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'কাজটি করা যায়নি');
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="space-y-4">
      <form onSubmit={doSearch} className="flex max-w-md gap-2">
        <label htmlFor="usearch" className="sr-only">ইউজার খুঁজুন</label>
        <input
          id="usearch"
          className="input"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="নাম, ইমেইল, ফোন বা রেফারেল কোড"
          type="search"
        />
        <button type="submit" className="btn-ghost shrink-0 px-5">খুঁজুন</button>
      </form>

      <div className="table-wrap">
        <table className="tbl tbl--stack">
          <thead>
            <tr>
              <th scope="col">ইউজার</th>
              <th scope="col">রেফারেল</th>
              <th scope="col" className="num">ব্যালেন্স</th>
              <th scope="col" className="num">অর্ডার</th>
              <th scope="col" className="num">ডিপোজিট</th>
              <th scope="col">যোগদান</th>
              <th scope="col" className="ctr">স্ট্যাটাস</th>
              <th scope="col" className="ctr">অ্যাকশন</th>
            </tr>
          </thead>
          <tbody>
            {users.map((u: (typeof users)[number]) => (
              <tr key={u.id} className={u.isBanned ? 'bg-red-50' : ''}>
                <td data-label="ইউজার">
                  <div className="flex items-center gap-2">
                    <Link href={`/admin/users/${u.id}`} className="text-sm font-medium text-slate-900 hover:text-rose-600 hover:underline">{u.name}</Link>
                    {u.role === 'ADMIN' && (
                      <span className="badge bg-purple-100 text-purple-700">ADMIN</span>
                    )}
                  </div>
                  <div className="break-all text-xs text-slate-400">{u.email}</div>
                  <div className="font-mono text-xs text-slate-400">{u.phone}</div>
                </td>

                <td data-label="রেফারেল">
                  <code className="rounded bg-slate-100 px-1.5 py-0.5 font-mono text-[11px] text-purple-700">
                    {u.referralCode}
                  </code>
                  {u.referrals > 0 && (
                    <div className="mt-1 text-[10px] text-emerald-600">
                      {u.referrals} জন রেফার
                    </div>
                  )}
                </td>

                <td data-label="ব্যালেন্স" className="whitespace-nowrap num font-bold text-emerald-600">
                  ৳{u.balance.toFixed(2)}
                </td>
                <td data-label="অর্ডার" className="num text-slate-400">{u.orders}</td>
                <td data-label="ডিপোজিট" className="num text-slate-400">{u.deposits}</td>
                <td data-label="যোগদান" className="whitespace-nowrap text-xs text-slate-400">{fmtDate(u.createdAt)}</td>

                <td data-label="স্ট্যাটাস" className="ctr">
                  {u.status === 'ACTIVE' ? (
                    <span className="badge border border-emerald-200 bg-emerald-100 text-emerald-700">সক্রিয়</span>
                  ) : u.status === 'SUSPENDED' ? (
                    <span className="badge border border-amber-200 bg-amber-100 text-amber-700">স্থগিত</span>
                  ) : (
                    <span className="badge border border-red-200 bg-red-100 text-red-700">বন্ধ</span>
                  )}
                </td>

                <td className="ctr">
                  <div className="tbl-actions">
                    {/* ★ ইমোজি → SVG, আর লক্ষ্য ২৪×৩২ → ৪০×৪০।
                        দুটোই মাপা ত্রুটি ছিল: অডিটে ৩৫টি "ছোট
                        ট্যাপ-টার্গেট" হিট, আর ইমোজি প্ল্যাটফর্মভেদে
                        বদলায় (CLAUDE.md §7 — বাকি অ্যাপ SVG ব্যবহার করে)।
                        `title` ছিল, কিন্তু স্ক্রিন-রিডারের জন্য
                        `aria-label`-ই নির্ভরযোগ্য। */}
                    <Link
                      href={`/admin/users/${u.id}`}
                      title="বিস্তারিত"
                      aria-label={`${u.name || u.email} — বিস্তারিত`}
                      className="btn-ghost grid h-10 w-10 place-items-center px-0 py-0"
                    >
                      <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                        <path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7-10-7-10-7z" />
                        <circle cx="12" cy="12" r="3" />
                      </svg>
                    </Link>
                    <button
                      disabled={busy === u.id}
                      onClick={() => openAdjust(u)}
                      title="ব্যালেন্স সমন্বয়"
                      className="btn-ghost px-2.5 py-1 text-xs"
                    >
                      ৳ ±
                    </button>
                    {u.role !== 'ADMIN' && (
                      <button
                        disabled={busy === u.id}
                        onClick={() => setBan(u)}
                        className={`px-2.5 py-1 text-xs ${u.isBanned ? 'btn-success' : 'btn-danger'}`}
                      >
                        {u.isBanned ? '↺' : '⛔'}
                      </button>
                    )}
                  </div>
                </td>
              </tr>
            ))}
            {users.length === 0 && (
              <tr>
                <td colSpan={8} className="py-14 ctr text-slate-400">
                  কোনো ইউজার পাওয়া যায়নি
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {/* ── ব্যালেন্স সমন্বয় ── */}
      <ConfirmDialog
        open={Boolean(adjust)}
        title={`${adjust?.name} — ব্যালেন্স সমন্বয়`}
        message={`বর্তমান ব্যালেন্স: ৳${adjust?.balance.toFixed(2)}\n\nধনাত্মক সংখ্যা = যোগ, ঋণাত্মক = বিয়োগ।\nপ্রতিটি সমন্বয় লেজারে রেকর্ড হবে।`}
        confirmLabel="সমন্বয় করুন"
        onConfirm={runAdjust}
        onCancel={() => setAdjust(null)}
      >
        <div className="space-y-3">
          <div>
            <label className="label">পরিমাণ (+ / −)</label>
            <input aria-label="পরিমাণ (+ / −)"
              className="input" type="number" step="0.01"
              value={amount}
              onChange={(e) => { setAmount(e.target.value); setAdjustKey(crypto.randomUUID()); }}
              placeholder="যেমন: 100 বা -50"
            />
          </div>
          <div>
            <label className="label">কারণ (বাধ্যতামূলক)</label>
            <input aria-label="কারণ (বাধ্যতামূলক)"
              className="input"
              value={note}
              onChange={(e) => { setNote(e.target.value); setAdjustKey(crypto.randomUUID()); }}
              placeholder="যেমন: ম্যানুয়াল রিফান্ড"
            />
          </div>
        </div>
      </ConfirmDialog>

      {/* ── ব্যান ── */}
      <ConfirmDialog
        open={Boolean(ban)}
        title={ban?.isBanned ? `${ban.name} আনব্যান করবেন?` : `${ban?.name} ব্যান করবেন?`}
        message={
          ban?.isBanned
            ? 'ইউজার আবার লগইন ও অর্ডার করতে পারবে।'
            : `ইউজার লগইন করতে পারবে না।\nবর্তমান ব্যালেন্স ৳${ban?.balance.toFixed(2)} অক্ষত থাকবে।`
        }
        confirmLabel={ban?.isBanned ? 'আনব্যান' : 'ব্যান করুন'}
        danger={!ban?.isBanned}
        onConfirm={runBan}
        onCancel={() => setBan(null)}
      />
    </div>
  );
}
