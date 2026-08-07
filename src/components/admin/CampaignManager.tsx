'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { useToast, ConfirmDialog } from '@/components/Toast';
import ImageUploader from '@/components/ImageUploader';

/**
 * ═══════════════════════════════════════════════════════════
 * ★ হোমপেজ বিপণন ব্যবস্থাপক (Option A infra)
 *
 *   একটিই স্ক্রিন থেকে হোমপেজের সব বিপণন-উপাদান — প্রবেশ পপআপ,
 *   হিরো কনটেন্ট, ব্যানার স্লাইডার, নোটিশ বার, বিশ্বাস-স্ট্রিপ ও
 *   প্রচারণা কার্ড — তৈরি, সম্পাদনা, চালু/বন্ধ ও মুছে ফেলা যায়।
 *
 *   ⚠️ অ্যাডমিন প্যানেল এখনো লিগ্যাসি ক্লাসে (`card`/`input`/`btn-*`)
 *   — সেগুলো VOLT টোকেনে alias করা, তাই রঙ ঠিক থাকে। এই ফাইল
 *   অবকাঠামো; অ্যাডমিনের পূর্ণ ভিজ্যুয়াল রিডিজাইন আলাদা ধাপ।
 * ═══════════════════════════════════════════════════════════
 */

export type CampaignRow = {
  id: number;
  placement: string;
  kind: string;
  title: string | null;
  subtitle: string | null;
  imageUrl: string | null;
  ctaLabel: string | null;
  ctaLink: string | null;
  badge: string | null;
  dismissible: boolean;
  frequency: string;
  isActive: boolean;
  sortOrder: number;
  startsAt: string | null;
  endsAt: string | null;
};

const PLACEMENTS: { value: string; label: string; hint: string }[] = [
  { value: 'POPUP', label: 'প্রবেশ পপআপ', hint: 'সাইটে ঢুকলেই যে মডাল ভেসে ওঠে — অফার/ইভেন্ট/গিভঅ্যাওয়ে' },
  { value: 'HERO', label: 'হিরো কনটেন্ট', hint: 'উপরের প্রধান অংশের শিরোনাম, লেখা, ছবি ও বোতাম' },
  { value: 'SLIDER', label: 'ব্যানার স্লাইডার', hint: 'প্রচারণা ব্যানার — একাধিক দিলে স্লাইড হয়' },
  { value: 'NOTICE', label: 'নোটিশ বার', hint: 'উপরে চলমান/স্থির ঘোষণা বার্তা' },
  { value: 'STRIP', label: 'বিশ্বাস স্ট্রিপ', hint: 'দ্রুত ডেলিভারি · নিরাপদ · ২৪ ঘণ্টা — জাতীয় ছোট বার্তা' },
  { value: 'PROMO', label: 'প্রচারণা কার্ড', hint: 'হোমপেজের প্রচারণামূলক সেকশনের কার্ড' },
  { value: 'FLOAT', label: 'ভাসমান কার্ড', hint: 'পর্দার কোণে ভেসে ওঠা ছোট ঘোষণা কার্ড (বন্ধ করা যায়)' },
];

const KINDS: { value: string; label: string }[] = [
  { value: 'OFFER', label: 'অফার' },
  { value: 'EVENT', label: 'ইভেন্ট' },
  { value: 'GIVEAWAY', label: 'গিভঅ্যাওয়ে' },
  { value: 'TOURNAMENT', label: 'টুর্নামেন্ট' },
  { value: 'COUPON', label: 'কুপন' },
  { value: 'NEW', label: 'নতুন' },
  { value: 'INFO', label: 'তথ্য' },
  { value: 'WARNING', label: 'সতর্কতা' },
  { value: 'PROMO', label: 'প্রচার' },
];

const placeLabel = (v: string) => PLACEMENTS.find((p) => p.value === v)?.label ?? v;

export default function CampaignManager({ items }: { items: CampaignRow[] }) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const toast = useToast();

  const [busy, setBusy] = useState(false);
  const [placement, setPlacement] = useState('SLIDER');
  const [kind, setKind] = useState('OFFER');
  const [title, setTitle] = useState('');
  const [subtitle, setSubtitle] = useState('');
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const [ctaLabel, setCtaLabel] = useState('');
  const [ctaLink, setCtaLink] = useState('');
  const [badge, setBadge] = useState('');
  const [dismissible, setDismissible] = useState(true);
  const [frequency, setFrequency] = useState('once');
  const [startsAt, setStartsAt] = useState('');
  const [endsAt, setEndsAt] = useState('');
  const [del, setDel] = useState<CampaignRow | null>(null);

  const activeHint = PLACEMENTS.find((p) => p.value === placement)?.hint;

  async function call(method: string, body: unknown, msg: string) {
    setBusy(true);
    try {
      const res = await fetch('/api/admin/campaign', {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const d = await res.json();
      if (!res.ok) throw new Error(d.error);
      toast.success(msg);
      startTransition(() => router.refresh());
      return true;
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'কাজটি করা যায়নি');
      return false;
    } finally {
      setBusy(false);
    }
  }

  async function add() {
    const ok = await call(
      'POST',
      {
        placement, kind,
        title: title.trim() || null,
        subtitle: subtitle.trim() || null,
        imageUrl: imageUrl || null,
        ctaLabel: ctaLabel.trim() || null,
        ctaLink: ctaLink.trim() || null,
        badge: badge.trim() || null,
        dismissible,
        frequency,
        startsAt: startsAt || null,
        endsAt: endsAt || null,
      },
      'যোগ হয়েছে — হোমপেজে দেখুন!'
    );
    if (ok) {
      setTitle(''); setSubtitle(''); setImageUrl(null);
      setCtaLabel(''); setCtaLink(''); setBadge('');
      setStartsAt(''); setEndsAt(''); setFrequency('once');
    }
  }

  const groups = PLACEMENTS.map((p) => ({
    ...p,
    rows: items.filter((i) => i.placement === p.value).sort((a, b) => a.sortOrder - b.sortOrder),
  })).filter((g) => g.rows.length > 0);

  return (
    <div className="space-y-6">
      {/* ── নতুন উপাদান ── */}
      <section className="card p-5">
        <h2 className="mb-4 text-lg font-bold text-slate-900">নতুন বিপণন উপাদান যোগ করুন</h2>

        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label className="label" htmlFor="cm-place">কোথায় দেখাবে</label>
            <select id="cm-place" className="input" value={placement} onChange={(e) => setPlacement(e.target.value)}>
              {PLACEMENTS.map((p) => <option key={p.value} value={p.value}>{p.label}</option>)}
            </select>
            {activeHint && <p className="mt-1.5 text-xs text-slate-500">{activeHint}</p>}
          </div>
          <div>
            <label className="label" htmlFor="cm-kind">ধরন</label>
            <select id="cm-kind" className="input" value={kind} onChange={(e) => setKind(e.target.value)}>
              {KINDS.map((k) => <option key={k.value} value={k.value}>{k.label}</option>)}
            </select>
          </div>
        </div>

        <div className="mt-4">
          <label className="label">ছবি (ঐচ্ছিক — পপআপ/ব্যানারে প্রস্তাবিত)</label>
          <ImageUploader
            value={imageUrl}
            onChange={setImageUrl}
            folder="campaigns"
            label=""
            aspect="aspect-[16/9]"
            hint="পপআপে বর্গাকার/লম্বা, স্লাইডারে চওড়া ছবি ভালো"
          />
        </div>

        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          <div>
            <label className="label" htmlFor="cm-title">শিরোনাম</label>
            <input id="cm-title" aria-label="শিরোনাম" className="input" value={title}
              onChange={(e) => setTitle(e.target.value)} placeholder="ঈদ ধামাকা অফার!" />
          </div>
          <div>
            <label className="label" htmlFor="cm-badge">ব্যাজ (ঐচ্ছিক)</label>
            <input id="cm-badge" aria-label="ব্যাজ" className="input" value={badge}
              onChange={(e) => setBadge(e.target.value)} placeholder="১০০% বোনাস" />
          </div>
        </div>

        <div className="mt-4">
          <label className="label" htmlFor="cm-sub">বিবরণ (ঐচ্ছিক)</label>
          <input id="cm-sub" aria-label="বিবরণ" className="input" value={subtitle}
            onChange={(e) => setSubtitle(e.target.value)} placeholder="সব প্যাকেজে ১০% পর্যন্ত ছাড় — শুধু আজকের জন্য" />
        </div>

        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          <div>
            <label className="label" htmlFor="cm-ctal">বোতামের লেখা (ঐচ্ছিক)</label>
            <input id="cm-ctal" aria-label="বোতামের লেখা" className="input" value={ctaLabel}
              onChange={(e) => setCtaLabel(e.target.value)} placeholder="অফার দেখুন" />
          </div>
          <div>
            <label className="label" htmlFor="cm-ctalink">বোতাম ক্লিকে কোথায় (ঐচ্ছিক)</label>
            <input id="cm-ctalink" aria-label="বোতাম লিংক" className="input" value={ctaLink}
              onChange={(e) => setCtaLink(e.target.value)} placeholder="/product/1  বা  https://t.me/..." />
          </div>
        </div>

        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          <div>
            <label className="label" htmlFor="cm-start">কখন থেকে দেখাবে (ঐচ্ছিক)</label>
            <input id="cm-start" type="datetime-local" aria-label="শুরুর সময়" className="input"
              value={startsAt} onChange={(e) => setStartsAt(e.target.value)} />
          </div>
          <div>
            <label className="label" htmlFor="cm-end">কখন পর্যন্ত (ঐচ্ছিক)</label>
            <input id="cm-end" type="datetime-local" aria-label="শেষের সময়" className="input"
              value={endsAt} onChange={(e) => setEndsAt(e.target.value)} />
          </div>
        </div>

        {placement === 'POPUP' && (
          <div className="mt-4 grid gap-4 sm:grid-cols-2">
            <div>
              <label className="label" htmlFor="cm-freq">কত ঘন ঘন দেখাবে</label>
              <select id="cm-freq" className="input" value={frequency} onChange={(e) => setFrequency(e.target.value)}>
                <option value="once">একবার (দর্শক বন্ধ করলে আর না)</option>
                <option value="session">প্রতি সেশনে একবার</option>
                <option value="always">প্রতিবার (জরুরি/maintenance)</option>
              </select>
            </div>
            <label className="flex cursor-pointer items-center gap-2.5 text-sm text-slate-700 sm:mt-7">
              <input type="checkbox" checked={dismissible} onChange={(e) => setDismissible(e.target.checked)} />
              বন্ধ করা যাবে (× বোতাম)
            </label>
          </div>
        )}

        <button onClick={add} disabled={busy} className="btn-primary mt-5 w-full py-3 sm:w-auto sm:px-8">
          {busy ? 'যোগ হচ্ছে...' : '+ যোগ করুন'}
        </button>
      </section>

      {/* ── বিদ্যমান উপাদান, placement ধরে ── */}
      {groups.length === 0 ? (
        <div className="card py-16 text-center">
          <p className="font-semibold text-slate-500">এখনো কোনো বিপণন উপাদান নেই</p>
          <p className="mt-1 text-sm text-slate-400">উপরে থেকে যোগ করুন — সাথে সাথেই হোমপেজে বসবে</p>
        </div>
      ) : (
        groups.map((g) => (
          <section key={g.value}>
            <h2 className="mb-3 text-sm font-bold uppercase tracking-wide text-slate-500">
              {g.label} ({g.rows.length}টি)
            </h2>
            <div className="space-y-3">
              {g.rows.map((c, i, arr) => (
                <CampaignItemRow
                  key={c.id} c={c} first={i === 0} last={i === arr.length - 1}
                  busy={busy} onCall={call} onDelete={() => setDel(c)}
                  neighbours={arr}
                />
              ))}
            </div>
          </section>
        ))
      )}

      <ConfirmDialog
        open={Boolean(del)}
        title="মুছে ফেলবেন?"
        message="এই বিপণন উপাদানটি হোমপেজ থেকে চলে যাবে। এটা আর ফেরানো যাবে না।"
        confirmLabel="হ্যাঁ, মুছুন"
        danger
        onConfirm={async () => {
          const c = del;
          setDel(null);
          if (c) await call('DELETE', { id: c.id }, 'মুছে ফেলা হয়েছে');
        }}
        onCancel={() => setDel(null)}
      />
    </div>
  );
}

function CampaignItemRow({
  c, first, last, busy, neighbours, onCall, onDelete,
}: {
  c: CampaignRow; first: boolean; last: boolean; busy: boolean;
  neighbours: CampaignRow[];
  onCall: (m: string, b: unknown, msg: string) => Promise<boolean>;
  onDelete: () => void;
}) {
  async function move(dir: -1 | 1) {
    const idx = neighbours.findIndex((x) => x.id === c.id);
    const swap = neighbours[idx + dir];
    if (!swap) return;
    await Promise.all([
      onCall('PATCH', { id: c.id, sortOrder: swap.sortOrder }, 'ক্রম বদলানো হয়েছে'),
      onCall('PATCH', { id: swap.id, sortOrder: c.sortOrder }, 'ক্রম বদলানো হয়েছে'),
    ]);
  }

  return (
    <div className={`card overflow-hidden ${!c.isActive ? 'opacity-60' : ''}`}>
      <div className="flex flex-col gap-3 sm:flex-row">
        {c.imageUrl && (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={c.imageUrl} alt="" className="aspect-[16/9] w-full object-cover sm:w-48 sm:shrink-0" />
        )}
        <div className="flex flex-1 flex-col justify-between gap-3 p-4">
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <span className="badge border border-blue-200 bg-blue-50 text-blue-800">{placeLabel(c.placement)}</span>
              <span className="badge border border-amber-200 bg-amber-50 text-amber-800">{c.kind}</span>
              {c.badge && <span className="badge border border-emerald-200 bg-emerald-50 text-emerald-700">{c.badge}</span>}
            </div>
            <p className="mt-2 font-bold text-slate-900">
              {c.title || <span className="font-normal text-slate-400">শিরোনাম নেই</span>}
            </p>
            {c.subtitle && <p className="mt-0.5 text-sm text-slate-500">{c.subtitle}</p>}
            {c.ctaLabel && (
              <p className="mt-0.5 text-xs text-slate-500">
                বোতাম: <strong>{c.ctaLabel}</strong>{c.ctaLink ? ` → ${c.ctaLink}` : ''}
              </p>
            )}
            {(c.startsAt || c.endsAt) && (
              <p className="mt-0.5 font-mono text-[11px] text-slate-400">
                {c.startsAt ? new Date(c.startsAt).toLocaleString('en-GB') : '—'}
                {' → '}
                {c.endsAt ? new Date(c.endsAt).toLocaleString('en-GB') : 'সীমাহীন'}
              </p>
            )}
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <div className="flex gap-1">
              <button disabled={busy || first} onClick={() => move(-1)} aria-label="উপরে নিন"
                className="btn-ghost px-2.5 py-1.5 text-xs disabled:opacity-30">↑</button>
              <button disabled={busy || last} onClick={() => move(1)} aria-label="নিচে নিন"
                className="btn-ghost px-2.5 py-1.5 text-xs disabled:opacity-30">↓</button>
            </div>
            <button
              disabled={busy}
              onClick={() => onCall('PATCH', { id: c.id, isActive: !c.isActive }, c.isActive ? 'লুকানো হলো' : 'দেখাচ্ছে')}
              className={`badge ${c.isActive
                ? 'border border-emerald-200 bg-emerald-100 text-emerald-700'
                : 'border border-slate-200 bg-slate-100 text-slate-500'}`}
            >
              {c.isActive ? 'দেখাচ্ছে' : 'লুকানো'}
            </button>
            <button disabled={busy} onClick={onDelete} className="btn-danger ml-auto px-3 py-1.5 text-xs">
              মুছুন
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
