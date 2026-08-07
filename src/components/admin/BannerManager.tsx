'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { useToast, ConfirmDialog } from '@/components/Toast';
import ImageUploader from '@/components/ImageUploader';

type B = {
  id: number; image: string; title: string | null;
  subtitle: string | null; link: string | null;
  isActive: boolean; sortOrder: number;
};

/**
 * ★ ব্যানার — সবচেয়ে সহজ ভাবে।
 *   ছবি টেনে ফেলুন → সাথে সাথেই হোমপেজে দেখাবে।
 */
export default function BannerManager({ banners }: { banners: B[] }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const toast = useToast();

  const [busy, setBusy] = useState(false);
  const [image, setImage] = useState<string | null>(null);
  const [title, setTitle] = useState('');
  const [subtitle, setSubtitle] = useState('');
  const [link, setLink] = useState('');
  const [del, setDel] = useState<B | null>(null);

  async function call(method: string, body: unknown, msg: string) {
    setBusy(true);
    try {
      const res = await fetch('/api/admin/banner', {
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
    if (!image) return toast.error('আগে ছবি আপলোড করুন');
    const ok = await call(
      'POST',
      { image, title: title.trim(), subtitle: subtitle.trim(), link: link.trim() },
      'ব্যানার যোগ হয়েছে — হোমপেজে দেখুন!'
    );
    if (ok) {
      setImage(null);
      setTitle('');
      setSubtitle('');
      setLink('');
    }
  }

  async function move(b: B, dir: -1 | 1) {
    const sorted = [...banners].sort((x, y) => x.sortOrder - y.sortOrder);
    const idx = sorted.findIndex((x) => x.id === b.id);
    const swap = sorted[idx + dir];
    if (!swap) return;

    setBusy(true);
    try {
      await Promise.all([
        fetch('/api/admin/banner', {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ id: b.id, sortOrder: swap.sortOrder }),
        }),
        fetch('/api/admin/banner', {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ id: swap.id, sortOrder: b.sortOrder }),
        }),
      ]);
      toast.success('ক্রম বদলানো হয়েছে');
      startTransition(() => router.refresh());
    } catch {
      toast.error('ক্রম বদলানো যায়নি');
    } finally {
      setBusy(false);
    }
  }

  const active = banners.filter((b: B) => b.isActive);

  return (
    <div className="space-y-6">
      {/* ── কীভাবে কাজ করে ── */}
      <div className="rounded-xl border-2 border-blue-200 bg-blue-50 p-4">
        <p className="text-sm leading-relaxed text-blue-800">
          <strong>💡 কীভাবে কাজ করে:</strong> নিচে ছবি টেনে এনে ছেড়ে দিন → &ldquo;ব্যানার যোগ করুন&rdquo; চাপুন
          → সাথে সাথেই হোমপেজের উপরে দেখাবে। একাধিক ব্যানার দিলে স্লাইড হবে।
        </p>
      </div>

      {/* ── নতুন ব্যানার ── */}
      <section className="card p-5">
        <h2 className="mb-4 text-lg font-bold text-slate-900">নতুন ব্যানার যোগ করুন</h2>

        <ImageUploader
          value={image}
          onChange={setImage}
          folder="banners"
          label=""
          aspect="aspect-[21/7]"
          hint="সবচেয়ে ভালো মাপ: 1600 × 550 পিক্সেল (চওড়া ছবি)"
        />

        <div className="mt-4 grid gap-4 sm:grid-cols-3">
          <div>
            <label className="label">শিরোনাম (ঐচ্ছিক)</label>
            <input aria-label="শিরোনাম (ঐচ্ছিক)"
              className="input"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="ঈদ অফার!"
            />
          </div>
          <div>
            <label className="label">ছোট লেখা (ঐচ্ছিক)</label>
            <input aria-label="ছোট লেখা (ঐচ্ছিক)"
              className="input"
              value={subtitle}
              onChange={(e) => setSubtitle(e.target.value)}
              placeholder="সব প্যাকেজে ১০% ছাড়"
            />
          </div>
          <div>
            <label className="label">ক্লিক করলে কোথায় যাবে (ঐচ্ছিক)</label>
            <input aria-label="ক্লিক করলে কোথায় যাবে (ঐচ্ছিক)"
              className="input"
              value={link}
              onChange={(e) => setLink(e.target.value)}
              placeholder="/product/1"
            />
          </div>
        </div>

        <button
          onClick={add}
          disabled={busy || !image}
          className="btn-primary mt-4 w-full py-3 sm:w-auto sm:px-8"
        >
          {busy ? 'যোগ হচ্ছে...' : '+ ব্যানার যোগ করুন'}
        </button>
      </section>

      {/* ── লাইভ প্রিভিউ ── */}
      {active.length > 0 && (
        <section>
          <h2 className="mb-3 flex items-center gap-2 text-sm font-bold uppercase tracking-wide text-slate-500">
            <span className="h-2 w-2 animate-pulse rounded-full bg-emerald-500" aria-hidden="true" />
            হোমপেজে এখন যা দেখাচ্ছে ({active.length}টি)
          </h2>
          <div className="overflow-hidden rounded-xl border-2 border-emerald-300 shadow-md">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={active[0].image}
              alt="প্রথম ব্যানার"
              className="aspect-[21/7] w-full object-cover"
            />
          </div>
        </section>
      )}

      {/* ── সব ব্যানার ── */}
      <section>
        <h2 className="mb-3 text-sm font-bold uppercase tracking-wide text-slate-500">
          সব ব্যানার ({banners.length}টি)
        </h2>

        {banners.length === 0 ? (
          <div className="card py-16 text-center">
            <p className="text-4xl" aria-hidden="true">🖼️</p>
            <p className="mt-3 font-semibold text-slate-500">কোনো ব্যানার নেই</p>
            <p className="mt-1 text-sm text-slate-400">উপরে থেকে ছবি টেনে এনে যোগ করুন</p>
          </div>
        ) : (
          <div className="space-y-3">
            {[...banners]
              .sort((a: B, b: B) => a.sortOrder - b.sortOrder)
              .map((b: B, i: number, arr: B[]) => (
                <div
                  key={b.id}
                  className={`card overflow-hidden ${!b.isActive ? 'opacity-50' : ''}`}
                >
                  <div className="flex flex-col gap-3 sm:flex-row">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={b.image}
                      alt=""
                      className="aspect-[21/7] w-full object-cover sm:w-64 sm:shrink-0"
                    />

                    <div className="flex flex-1 flex-col justify-between gap-3 p-4">
                      <div>
                        <div className="flex items-center gap-2">
                          <span className="rounded bg-slate-100 px-2 py-0.5 text-[10px] font-bold text-slate-500">
                            #{i + 1}
                          </span>
                          <p className="font-bold text-slate-900">
                            {b.title || <span className="font-normal text-slate-400">শিরোনাম নেই</span>}
                          </p>
                        </div>
                        {b.subtitle && (
                          <p className="mt-0.5 text-sm text-slate-500">{b.subtitle}</p>
                        )}
                        {b.link && (
                          <p className="mt-0.5 font-mono text-xs text-rose-600">→ {b.link}</p>
                        )}
                      </div>

                      <div className="flex flex-wrap items-center gap-2">
                        {/* ক্রম বদলানো */}
                        <div className="flex gap-1">
                          <button
                            disabled={busy || i === 0}
                            onClick={() => move(b, -1)}
                            aria-label="উপরে নিন"
                            title="আগে দেখাও"
                            className="btn-ghost px-2.5 py-1.5 text-xs disabled:opacity-30"
                          >
                            ↑
                          </button>
                          <button
                            disabled={busy || i === arr.length - 1}
                            onClick={() => move(b, 1)}
                            aria-label="নিচে নিন"
                            title="পরে দেখাও"
                            className="btn-ghost px-2.5 py-1.5 text-xs disabled:opacity-30"
                          >
                            ↓
                          </button>
                        </div>

                        <button
                          disabled={busy}
                          onClick={() =>
                            call(
                              'PATCH',
                              { id: b.id, isActive: !b.isActive },
                              b.isActive ? 'ব্যানার লুকানো হলো' : 'ব্যানার দেখাচ্ছে'
                            )
                          }
                          className={`badge ${
                            b.isActive
                              ? 'border border-emerald-200 bg-emerald-100 text-emerald-700'
                              : 'border border-slate-200 bg-slate-100 text-slate-500'
                          }`}
                        >
                          {b.isActive ? '👁 দেখাচ্ছে' : '🚫 লুকানো'}
                        </button>

                        <button
                          disabled={busy}
                          onClick={() => setDel(b)}
                          className="btn-danger ml-auto px-3 py-1.5 text-xs"
                        >
                          🗑 মুছুন
                        </button>
                      </div>
                    </div>
                  </div>
                </div>
              ))}
          </div>
        )}
      </section>

      <ConfirmDialog
        open={Boolean(del)}
        title="ব্যানার মুছে ফেলবেন?"
        message="ছবিটিও স্টোরেজ থেকে মুছে যাবে। এটা আর ফেরানো যাবে না।"
        confirmLabel="হ্যাঁ, মুছুন"
        danger
        onConfirm={async () => {
          const b = del;
          setDel(null);
          if (b) await call('DELETE', { id: b.id }, 'ব্যানার মুছে ফেলা হয়েছে');
        }}
        onCancel={() => setDel(null)}
      />
    </div>
  );
}
