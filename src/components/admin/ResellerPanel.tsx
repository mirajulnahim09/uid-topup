'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { useToast, ConfirmDialog } from '@/components/Toast';
import { fmtDate } from '@/lib/date';

/**
 * ═══════════════════════════════════════════════════════════
 * ★★★ রিসেলার প্যানেল (Group F) — স্তর + API কী, এক জায়গায়
 *
 *   এর আগে দুটোই কেবল HTTP কল দিয়ে (তারও আগে কাঁচা SQL দিয়ে) করা
 *   যেত, অর্থাৎ ফিচারটি মালিকের কাছে কার্যত অব্যবহার্য ছিল।
 *
 *   ⚠️ কাঁচা কী সার্ভার **একবারই** পাঠায় (DB-তে কেবল হ্যাশ)। তাই
 *   সেটি এখানে state-এ ধরে রাখা হয় ও একটি ডায়ালগে দেখানো হয়, আর
 *   পরিষ্কার করে বলা হয় যে এটি আর কখনো দেখা যাবে না। পাতা রিফ্রেশ
 *   হলে মানটি হারায় — সেটিই কাম্য, কারণ এটি ওয়ালেটে হাত দেওয়ার
 *   ক্ষমতা এবং স্ক্রিনে বসে থাকা উচিত নয়।
 * ═══════════════════════════════════════════════════════════
 */

export type AdminApiKey = {
  id: string;
  label: string;
  prefix: string;
  createdAt: string;
  lastUsedAt: string | null;
  revokedAt: string | null;
  createdByName: string | null;
};

export default function ResellerPanel({
  userId,
  name,
  tier,
  keys,
}: {
  userId: string;
  name: string;
  tier: 'NORMAL' | 'RESELLER';
  keys: AdminApiKey[];
}) {
  const router = useRouter();
  const toast = useToast();
  const [, startTransition] = useTransition();

  const [busy, setBusy] = useState(false);
  const [tierOpen, setTierOpen] = useState(false);
  const [keyOpen, setKeyOpen] = useState(false);
  const [label, setLabel] = useState('');
  const [revokeId, setRevokeId] = useState<string | null>(null);
  /** ★ কেবল এই সেশনে দেখানোর জন্য — কোথাও সংরক্ষিত হয় না */
  const [freshKey, setFreshKey] = useState<string | null>(null);

  const isReseller = tier === 'RESELLER';
  const active = keys.filter((k) => !k.revokedAt);

  async function call(url: string, method: string, body: unknown) {
    setBusy(true);
    try {
      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const d = await res.json();
      if (!res.ok) throw new Error(d.error);
      startTransition(() => router.refresh());
      return d;
    } finally {
      setBusy(false);
    }
  }

  async function runTier() {
    const target = isReseller ? 'NORMAL' : 'RESELLER';
    setTierOpen(false);
    try {
      await call('/api/admin/user/tier', 'PATCH', { userId, tier: target });
      toast.success(
        target === 'RESELLER'
          ? `${name} এখন রিসেলার — নির্ধারিত প্যাকেজে ছাড় প্রযোজ্য`
          : `${name} সাধারণ স্তরে ফিরে গেছেন — তাঁর সব API কী অকেজো`,
      );
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'স্তর বদলানো যায়নি');
    }
  }

  async function runCreateKey() {
    if (label.trim().length < 2) return toast.error('কীটির একটি নাম দিন');
    setKeyOpen(false);
    try {
      const d = await call('/api/admin/user/api-key', 'POST', { userId, label: label.trim() });
      setLabel('');
      setFreshKey(d.plainKey);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'কী তৈরি করা যায়নি');
    }
  }

  async function runRevoke() {
    const id = revokeId;
    setRevokeId(null);
    if (!id) return;
    try {
      await call('/api/admin/user/api-key', 'DELETE', { keyId: id });
      toast.success('কী প্রত্যাহার করা হয়েছে');
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'প্রত্যাহার করা যায়নি');
    }
  }

  return (
    <div className="card p-5">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-sm font-bold uppercase tracking-wide text-slate-400">
          রিসেলার
        </h2>
        <div className="flex flex-wrap gap-2">
          <button disabled={busy} onClick={() => setTierOpen(true)}
            className={isReseller ? 'btn-ghost' : 'btn-primary'}>
            {isReseller ? '↩ সাধারণ স্তরে ফেরান' : '★ রিসেলার বানান'}
          </button>
          {isReseller && (
            <button disabled={busy} onClick={() => { setLabel(''); setKeyOpen(true); }} className="btn-ghost">
              + নতুন API কী
            </button>
          )}
        </div>
      </div>

      <p className="text-sm text-slate-400">
        {isReseller ? (
          <>
            স্তর: <span className="font-semibold" style={{ color: 'var(--v-volt)' }}>RESELLER</span>
            {' · '}সক্রিয় কী: {active.length}
          </>
        ) : (
          <>স্তর: NORMAL — রিসেলার দাম প্রযোজ্য নয়, API কীও দেওয়া যাবে না।</>
        )}
      </p>

      {isReseller && keys.length > 0 && (
        <div className="table-wrap mt-4">
          <table className="tbl tbl--stack">
            <thead>
              <tr><th>নাম</th><th>কী</th><th>শেষ ব্যবহার</th><th>তৈরি</th><th>অবস্থা</th><th></th></tr>
            </thead>
            <tbody>
              {keys.map((k) => (
                <tr key={k.id}>
                  <td data-label="নাম" className="text-sm text-slate-900">{k.label}</td>
                  {/* ⚠️ কেবল উপসর্গ — পুরো মান সার্ভার কখনো ফেরত দেয় না */}
                  <td data-label="কী" className="font-mono text-xs text-slate-400">{k.prefix}…</td>
                  <td data-label="শেষ ব্যবহার" className="whitespace-nowrap text-xs text-slate-400">
                    {k.lastUsedAt ? fmtDate(k.lastUsedAt) : 'কখনো নয়'}
                  </td>
                  <td data-label="তৈরি" className="whitespace-nowrap text-xs text-slate-400">
                    {fmtDate(k.createdAt)}
                    {k.createdByName ? ` · ${k.createdByName}` : ''}
                  </td>
                  <td data-label="অবস্থা">
                    {k.revokedAt
                      ? <span className="badge border border-red-200 bg-red-100 text-red-700">প্রত্যাহৃত</span>
                      : <span className="badge border border-emerald-200 bg-emerald-100 text-emerald-700">সক্রিয়</span>}
                  </td>
                  {/* ⚠️ লেবেল নেই — শেষ কলামের `<th>` ও খালি। ফোনে
                      `justify-content:flex-end` পড়ে, তাই বোতামটি কার্ডের
                      ডান কিনারায় বসে। কী প্রত্যাহার করলে ওই কী দিয়ে করা
                      অর্ডার সাথে সাথে বন্ধ হয়, তাই এটি বাঁয়ে অন্য
                      টেক্সটের সাথে মিশে যাওয়া উচিত নয়। */}
                  <td>
                    {!k.revokedAt && (
                      <button disabled={busy} onClick={() => setRevokeId(k.id)}
                        className="text-xs font-semibold text-rose-600 hover:underline">
                        প্রত্যাহার
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <ConfirmDialog
        open={tierOpen}
        title={`${name} — ${isReseller ? 'সাধারণ স্তরে ফেরানো' : 'রিসেলার বানানো'}`}
        message={
          isReseller
            ? 'রিসেলার দাম আর প্রযোজ্য হবে না এবং তাঁর সব API কী সাথে সাথে অকেজো হয়ে যাবে।\n\nপুরনো অর্ডার ও খতিয়ান অপরিবর্তিত থাকবে।'
            : 'যেসব প্যাকেজে রিসেলার দাম বসানো আছে, সেগুলোতে তিনি ছাড় পাবেন।\n\nপুরনো অর্ডারের দাম বদলাবে না।'
        }
        confirmLabel="নিশ্চিত করুন"
        danger={isReseller}
        onConfirm={runTier}
        onCancel={() => setTierOpen(false)}
      />

      <ConfirmDialog
        open={keyOpen}
        title="নতুন API কী"
        message={`${name} এর জন্য একটি কী তৈরি হবে।\n\nএই কী দিয়ে তাঁর ওয়ালেট থেকে টাকা কেটে অর্ডার করা যাবে — কেবল বিশ্বস্ত সিস্টেমকে দিন।`}
        confirmLabel="তৈরি করুন"
        onConfirm={runCreateKey}
        onCancel={() => setKeyOpen(false)}
      >
        <div>
          <label className="label">কীটির নাম</label>
          <input aria-label="কীটির নাম" className="input" value={label} maxLength={40}
            onChange={(e) => setLabel(e.target.value)} placeholder="যেমন: নিজের প্যানেল" />
        </div>
      </ConfirmDialog>

      <ConfirmDialog
        open={Boolean(freshKey)}
        title="কীটি এখনই সংরক্ষণ করুন"
        message="এটি আর কখনো দেখানো সম্ভব নয় — সার্ভারে কেবল এর হ্যাশ আছে। হারিয়ে গেলে নতুন কী তৈরি করতে হবে।"
        confirmLabel="সংরক্ষণ করেছি"
        onConfirm={() => setFreshKey(null)}
        onCancel={() => setFreshKey(null)}
      >
        <div className="break-all rounded-lg p-3 font-mono text-sm"
          style={{ background: 'var(--v-steel)', color: 'var(--v-ink)' }}>
          {freshKey}
        </div>
      </ConfirmDialog>

      <ConfirmDialog
        open={Boolean(revokeId)}
        title="কী প্রত্যাহার"
        message="এই কী দিয়ে আর কোনো অর্ডার করা যাবে না। যে সিস্টেম এটি ব্যবহার করছে সেটি সাথে সাথেই বন্ধ হয়ে যাবে।\n\nরেকর্ডটি মুছে যাবে না — কোন কী কবে সক্রিয় ছিল তা পরে দেখা যাবে।"
        confirmLabel="প্রত্যাহার করুন"
        danger
        onConfirm={runRevoke}
        onCancel={() => setRevokeId(null)}
      />
    </div>
  );
}
