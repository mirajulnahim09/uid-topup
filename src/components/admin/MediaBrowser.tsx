'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import SafeImage from '@/components/fx/SafeImage';
import { useToast } from '@/components/Toast';
import { processImage } from '@/lib/imageProcess';

/**
 * ═══════════════════════════════════════════════════════════
 * ★ MediaBrowser — কেন্দ্রীয় মিডিয়া লাইব্রেরির মূল UI।
 *
 *   দুই মোডে একই কম্পোনেন্ট:
 *   • mode="manage" — /admin/media পেজ: প্রিভিউ/সম্পাদনা/delete
 *   • mode="pick"   — MediaPicker মডাল: ক্লিকে ছবি বেছে onPick(url)
 *
 *   ফিচার: আপলোড (ক্লায়েন্ট-সাইড WebP কম্প্রেশন) · search · ফোল্ডার
 *   ফিল্টার · sort · unused-ফিল্টার · SEO মেটাডেটা (alt/title/desc) ·
 *   ব্যবহৃত-হলে নিরাপদ delete।
 * ═══════════════════════════════════════════════════════════
 */

type Media = {
  id: string; url: string; folder: string; mime: string; bytes: number;
  width: number | null; height: number | null;
  alt: string | null; title: string | null; description: string | null;
  storage: string; createdAt: string; inUse: boolean;
};

const FOLDER_LABEL: Record<string, string> = {
  products: 'প্রোডাক্ট', banners: 'ব্যানার', payments: 'পেমেন্ট', site: 'সাইট',
  categories: 'ক্যাটাগরি', campaigns: 'ক্যাম্পেইন', popups: 'পপআপ', media: 'সাধারণ',
};
const FOLDERS = Object.keys(FOLDER_LABEL);

function kb(b: number) { return b < 1024 * 1024 ? `${Math.round(b / 1024)} KB` : `${(b / 1048576).toFixed(1)} MB`; }

export default function MediaBrowser({
  mode = 'manage',
  onPick,
  defaultFolder = '',
}: {
  mode?: 'manage' | 'pick';
  onPick?: (m: { url: string; alt: string | null }) => void;
  defaultFolder?: string;
}) {
  const toast = useToast();
  const fileRef = useRef<HTMLInputElement>(null);

  const [items, setItems] = useState<Media[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  const [q, setQ] = useState('');
  const [folder, setFolder] = useState(defaultFolder);
  const [sort, setSort] = useState('new');
  const [unused, setUnused] = useState(false);
  const [uploadFolder, setUploadFolder] = useState(defaultFolder || 'media');

  const [sel, setSel] = useState<Media | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const p = new URLSearchParams();
      if (q) p.set('q', q);
      if (folder) p.set('folder', folder);
      if (sort) p.set('sort', sort);
      if (unused) p.set('unused', '1');
      const res = await fetch(`/api/admin/media?${p.toString()}`);
      const d = await res.json();
      if (!res.ok) throw new Error(d.error || 'লোড ব্যর্থ');
      setItems(d.items); setTotal(d.total);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'লোড ব্যর্থ');
    } finally { setLoading(false); }
  }, [q, folder, sort, unused, toast]);

  // debounce search; instant on other filters
  useEffect(() => { const t = setTimeout(load, q ? 300 : 0); return () => clearTimeout(t); }, [load, q]);

  const doUpload = useCallback(async (file: File) => {
    if (!/^image\/(jpeg|png|webp|gif)$/.test(file.type)) { toast.error('শুধু JPG, PNG, WebP, GIF'); return; }
    setBusy(true);
    try {
      const out = await processImage(file, { aspect: null, maxSize: 1600, quality: 0.85 });
      const fd = new FormData();
      fd.append('file', out.file);
      fd.append('folder', uploadFolder);
      fd.append('width', String(out.width));
      fd.append('height', String(out.height));
      const res = await fetch('/api/admin/media', { method: 'POST', body: fd });
      const d = await res.json();
      if (!res.ok) throw new Error(d.error || 'আপলোড ব্যর্থ');
      toast.success(`আপলোড হয়েছে (${kb(out.bytes)})`);
      await load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'আপলোড ব্যর্থ');
    } finally { setBusy(false); }
  }, [uploadFolder, load, toast]);

  const saveMeta = useCallback(async () => {
    if (!sel) return;
    setBusy(true);
    try {
      const res = await fetch('/api/admin/media', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: sel.id, alt: sel.alt, title: sel.title, description: sel.description }),
      });
      const d = await res.json();
      if (!res.ok) throw new Error(d.error || 'সংরক্ষণ ব্যর্থ');
      toast.success('মেটাডেটা সংরক্ষিত');
      setItems((xs) => xs.map((x) => (x.id === sel.id ? { ...x, alt: sel.alt, title: sel.title, description: sel.description } : x)));
    } catch (e) { toast.error(e instanceof Error ? e.message : 'সংরক্ষণ ব্যর্থ'); }
    finally { setBusy(false); }
  }, [sel, toast]);

  const del = useCallback(async (m: Media, force = false) => {
    if (!force && !confirm('এই ছবিটি মুছবেন?')) return;
    setBusy(true);
    try {
      const res = await fetch('/api/admin/media', {
        method: 'DELETE', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: m.id, force }),
      });
      const d = await res.json();
      if (res.status === 409 && d.code === 'IN_USE') {
        if (confirm('এই ছবিটি এখনো কোথাও ব্যবহৃত হচ্ছে। তবুও মুছবেন?')) return del(m, true);
        return;
      }
      if (!res.ok) throw new Error(d.error || 'মুছতে ব্যর্থ');
      toast.success('মুছে ফেলা হয়েছে');
      setSel(null); await load();
    } catch (e) { toast.error(e instanceof Error ? e.message : 'মুছতে ব্যর্থ'); }
    finally { setBusy(false); }
  }, [load, toast]);

  return (
    <div>
      {/* ── কন্ট্রোল বার ── */}
      <div className="flex flex-wrap items-center gap-2">
        <input
          className="input h-10 flex-1 min-w-[180px]"
          placeholder="খুঁজুন — নাম, alt, ফাইল…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          aria-label="মিডিয়া খুঁজুন"
        />
        <select className="input h-10 w-auto" value={folder} onChange={(e) => setFolder(e.target.value)} aria-label="ফোল্ডার">
          <option value="">সব ফোল্ডার</option>
          {FOLDERS.map((f) => <option key={f} value={f}>{FOLDER_LABEL[f]}</option>)}
        </select>
        <select className="input h-10 w-auto" value={sort} onChange={(e) => setSort(e.target.value)} aria-label="সাজান">
          <option value="new">নতুন আগে</option>
          <option value="old">পুরনো আগে</option>
          <option value="big">বড় আগে</option>
          <option value="small">ছোট আগে</option>
        </select>
        <button
          type="button"
          onClick={() => setUnused((v) => !v)}
          aria-pressed={unused}
          className="v-chip"
          style={unused ? { borderColor: 'var(--violet)', color: 'var(--violet)', background: 'var(--tint-violet)' } : undefined}
        >
          অব্যবহৃত
        </button>
        <button type="button" onClick={() => fileRef.current?.click()} disabled={busy} className="btn-primary h-10">
          {busy ? 'আপলোড…' : '+ আপলোড'}
        </button>
        <select className="input h-10 w-auto" value={uploadFolder} onChange={(e) => setUploadFolder(e.target.value)} aria-label="আপলোড ফোল্ডার" title="নতুন আপলোড কোন ফোল্ডারে যাবে">
          {FOLDERS.map((f) => <option key={f} value={f}>→ {FOLDER_LABEL[f]}</option>)}
        </select>
        <input ref={fileRef} type="file" accept="image/jpeg,image/png,image/webp,image/gif" className="sr-only"
          aria-label="ছবি নির্বাচন করুন"
          onChange={(e) => { const f = e.target.files?.[0]; if (f) doUpload(f); e.target.value = ''; }} />
      </div>

      <p className="mt-2 text-xs" style={{ color: 'var(--v-mut)' }}>
        {loading ? 'লোড হচ্ছে…' : `${total.toLocaleString('bn-BD')} টি মিডিয়া`}
      </p>

      {/* ── গ্রিড ── */}
      <div
        className="mt-3 rounded-xl border-2 border-dashed p-3"
        style={{ borderColor: 'var(--v-edge)' }}
        onDragOver={(e) => e.preventDefault()}
        onDrop={(e) => { e.preventDefault(); const f = e.dataTransfer.files?.[0]; if (f) doUpload(f); }}
      >
        {items.length === 0 && !loading ? (
          <p className="py-12 text-center text-sm" style={{ color: 'var(--v-mut)' }}>
            {unused ? 'কোনো অব্যবহৃত মিডিয়া নেই।' : 'এখনো কোনো মিডিয়া নেই — টেনে আনুন বা "আপলোড" চাপুন।'}
          </p>
        ) : (
          <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 md:grid-cols-4 xl:grid-cols-6">
            {items.map((m) => (
              <button
                key={m.id}
                type="button"
                onClick={() => (mode === 'pick' ? onPick?.({ url: m.url, alt: m.alt }) : setSel(m))}
                className="group relative overflow-hidden rounded-lg border text-left transition hover:-translate-y-0.5"
                style={{ borderColor: 'var(--v-edge2)', background: 'var(--v-fill)' }}
                title={m.title || m.alt || m.url}
              >
                <span className="relative block aspect-square" style={{ background: 'var(--v-void)' }}>
                  <SafeImage src={m.url} alt={m.alt || ''} sizes="200px" className="object-cover" />
                </span>
                <span className="absolute left-1.5 top-1.5 rounded px-1.5 py-0.5 text-[9px] font-bold"
                  style={{ background: m.inUse ? 'rgba(163,230,53,.85)' : 'rgba(0,0,0,.6)', color: m.inUse ? '#0a1400' : '#fff' }}>
                  {m.inUse ? 'ব্যবহৃত' : 'অব্যবহৃত'}
                </span>
                <span className="block px-2 py-1.5">
                  <span className="block truncate text-[11px] font-semibold" style={{ color: 'var(--v-ink)' }}>
                    {m.title || m.alt || FOLDER_LABEL[m.folder] || m.folder}
                  </span>
                  <span className="block text-[10px]" style={{ color: 'var(--v-dim)' }}>
                    {m.width && m.height ? `${m.width}×${m.height} · ` : ''}{kb(m.bytes)}
                  </span>
                </span>
              </button>
            ))}
          </div>
        )}
      </div>

      {/* ── প্রিভিউ / সম্পাদনা ড্রয়ার (manage মোড) ── */}
      {mode === 'manage' && sel && (
        <div className="fixed inset-0 z-[95] flex justify-end" style={{ background: 'rgba(0,0,0,.5)' }} onClick={() => setSel(null)}>
          <div className="h-full w-full max-w-md overflow-y-auto p-5" style={{ background: 'var(--v-pit)', borderLeft: '1px solid var(--v-edge2)' }} onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between">
              <h3 className="text-lg font-bold" style={{ color: 'var(--v-ink)' }}>মিডিয়া তথ্য</h3>
              <button onClick={() => setSel(null)} aria-label="বন্ধ" className="grid h-9 w-9 place-items-center rounded-lg" style={{ color: 'var(--v-mut)' }}>
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2"><path d="M6 6l12 12M18 6L6 18" /></svg>
              </button>
            </div>
            <div className="relative mt-3 aspect-video overflow-hidden rounded-lg" style={{ background: 'var(--v-void)' }}>
              <SafeImage src={sel.url} alt={sel.alt || ''} sizes="400px" className="object-contain" />
            </div>
            <dl className="mt-3 grid grid-cols-2 gap-2 text-xs" style={{ color: 'var(--v-mut)' }}>
              <div><dt className="opacity-70">মাপ</dt><dd style={{ color: 'var(--v-ink)' }}>{sel.width && sel.height ? `${sel.width}×${sel.height}` : '—'}</dd></div>
              <div><dt className="opacity-70">সাইজ</dt><dd style={{ color: 'var(--v-ink)' }}>{kb(sel.bytes)}</dd></div>
              <div><dt className="opacity-70">ফরম্যাট</dt><dd style={{ color: 'var(--v-ink)' }}>{sel.mime.replace('image/', '').toUpperCase()}</dd></div>
              <div><dt className="opacity-70">স্টোরেজ</dt><dd style={{ color: 'var(--v-ink)' }}>{sel.storage}</dd></div>
            </dl>

            {/* SEO/a11y মেটাডেটা */}
            <label className="label mt-4">Alt টেক্সট (SEO/অ্যাক্সেসিবিলিটি)</label>
            <input aria-label="Alt টেক্সট" className="input" value={sel.alt || ''} onChange={(e) => setSel({ ...sel, alt: e.target.value })} placeholder="ছবিটি কী দেখাচ্ছে" />
            <label className="label mt-3">টাইটেল</label>
            <input aria-label="টাইটেল" className="input" value={sel.title || ''} onChange={(e) => setSel({ ...sel, title: e.target.value })} placeholder="সংক্ষিপ্ত নাম" />
            <label className="label mt-3">বিবরণ</label>
            <textarea aria-label="বিবরণ" className="input min-h-[70px]" value={sel.description || ''} onChange={(e) => setSel({ ...sel, description: e.target.value })} placeholder="ঐচ্ছিক বিবরণ" />

            <div className="mt-3 flex items-center gap-2">
              <button onClick={saveMeta} disabled={busy} className="btn-primary flex-1">সংরক্ষণ</button>
              <button onClick={() => { navigator.clipboard?.writeText(sel.url); toast.success('URL কপি হয়েছে'); }} className="btn-ghost">URL কপি</button>
            </div>
            <button onClick={() => del(sel)} disabled={busy} className="btn-danger mt-2 w-full">
              {sel.inUse ? 'মুছুন (ব্যবহৃত!)' : 'মুছে ফেলুন'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
