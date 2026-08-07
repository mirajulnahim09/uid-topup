'use client';

import { useCallback, useRef, useState } from 'react';
import { useToast } from './Toast';
import { processImage, type CropOffset } from '@/lib/imageProcess';

/**
 * ★ Drag & drop ছবি আপলোডার (v2 — ক্রপ + কম্প্রেশন + WebP + প্রিভিউ)
 *   - টেনে আনা, ক্লিক, paste (Ctrl+V) — তিন ভাবেই ফাইল নেওয়া যায়
 *   - নেওয়ার পর সরাসরি আপলোড নয় → **প্রিভিউ** দেখায়; ক্রপ-অবস্থান
 *     টেনে ঠিক করা যায় (cropAspect দিলে)
 *   - "সংরক্ষণ" চাপলে ব্রাউজারেই রিসাইজ + WebP কম্প্রেশন হয়, তারপর
 *     ছোট অপ্টিমাইজড ফাইল আপলোড হয়
 *   - keyboard accessible; server-এ magic-byte check বহাল
 */
const MAX_MB = 8;
const OK = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];

export default function ImageUploader({
  value, onChange, folder = 'site', label = 'ছবি',
  hint, aspect = 'aspect-video', endpoint = '/api/admin/upload',
  cropAspect,
}: {
  value: string | null;
  onChange: (url: string | null) => void;
  folder?: string;
  label?: string;
  hint?: string;
  aspect?: string;
  endpoint?: string;
  /** ★ দিলে এই aspect-এ কভার-ক্রপ হয় (w/h); নাহলে মূল aspect + শুধু compress */
  cropAspect?: number;
}) {
  const toast = useToast();
  const inputRef = useRef<HTMLInputElement>(null);
  const frameRef = useRef<HTMLDivElement>(null);
  const dragState = useRef<{ x: number; y: number; ox: number; oy: number } | null>(null);

  const [drag, setDrag] = useState(false);
  const [busy, setBusy] = useState(false);
  const [pending, setPending] = useState<{ file: File; url: string } | null>(null);
  const [offset, setOffset] = useState<CropOffset>({ x: 0.5, y: 0.5 });

  const previewAspect = cropAspect ?? 16 / 9;

  const clearPending = useCallback(() => {
    setPending((p) => { if (p) URL.revokeObjectURL(p.url); return null; });
    setOffset({ x: 0.5, y: 0.5 });
  }, []);

  /** ফাইল যাচাই করে প্রিভিউতে বসায় (এখনো আপলোড নয়) */
  const pick = useCallback((file: File) => {
    if (!OK.includes(file.type)) { toast.error('শুধু JPG, PNG, WebP বা GIF ছবি দিন'); return; }
    if (file.size > MAX_MB * 1024 * 1024) {
      toast.error(`ছবি ${MAX_MB} MB এর কম হতে হবে (আপনারটি ${(file.size / 1048576).toFixed(1)} MB)`);
      return;
    }
    setOffset({ x: 0.5, y: 0.5 });
    setPending({ file, url: URL.createObjectURL(file) });
  }, [toast]);

  /** প্রসেস (ক্রপ+রিসাইজ+WebP) → আপলোড */
  const save = useCallback(async () => {
    if (!pending) return;
    setBusy(true);
    try {
      const out = await processImage(pending.file, {
        aspect: cropAspect ?? null,
        maxSize: 1280,
        quality: 0.85,
        offset,
      });

      const fd = new FormData();
      fd.append('file', out.file);
      fd.append('folder', folder);

      const res = await fetch(endpoint, { method: 'POST', body: fd });
      const d = await res.json();
      if (!res.ok) throw new Error(d.error || 'আপলোড ব্যর্থ');

      onChange(d.url);
      clearPending();
      toast.success(`ছবি আপলোড হয়েছে (${(out.bytes / 1024).toFixed(0)} KB)`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'আপলোড ব্যর্থ');
    } finally {
      setBusy(false);
    }
  }, [pending, cropAspect, offset, folder, endpoint, onChange, clearPending, toast]);

  // ── ক্রপ reposition (পয়েন্টার ড্র্যাগ) ──
  const onPointerDown = (e: React.PointerEvent) => {
    if (!cropAspect) return; // ক্রপ না থাকলে reposition অর্থহীন
    dragState.current = { x: e.clientX, y: e.clientY, ox: offset.x, oy: offset.y };
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
  };
  const onPointerMove = (e: React.PointerEvent) => {
    const st = dragState.current;
    const frame = frameRef.current;
    if (!st || !frame) return;
    const rect = frame.getBoundingClientRect();
    // ড্র্যাগ ডান = ছবি ডানে সরে (বাম অংশ দেখা যায়) → offset কমে
    const nx = st.ox - (e.clientX - st.x) / rect.width;
    const ny = st.oy - (e.clientY - st.y) / rect.height;
    setOffset({ x: Math.min(1, Math.max(0, nx)), y: Math.min(1, Math.max(0, ny)) });
  };
  const onPointerUp = () => { dragState.current = null; };

  return (
    <div>
      {label && <label className="label">{label}</label>}

      {/* ── ধাপ ৩: প্রিভিউ + ক্রপ (নতুন ফাইল বেছে নেওয়ার পর) ── */}
      {pending ? (
        <div className="rounded-xl border-2 p-3" style={{ borderColor: 'var(--v-edge2)', background: 'var(--v-fill)' }}>
          <div
            ref={frameRef}
            className={`relative w-full overflow-hidden rounded-lg ${cropAspect ? 'cursor-move' : ''}`}
            style={{ aspectRatio: String(previewAspect), background: 'var(--v-void)', touchAction: 'none' }}
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={pending.url}
              alt="প্রিভিউ"
              draggable={false}
              className="absolute inset-0 h-full w-full select-none"
              style={{ objectFit: 'cover', objectPosition: `${offset.x * 100}% ${offset.y * 100}%` }}
            />
            {cropAspect && (
              <span className="pointer-events-none absolute bottom-1.5 left-1.5 rounded px-1.5 py-0.5 text-[10px] font-semibold"
                style={{ background: 'rgba(0,0,0,.55)', color: '#fff' }}>
                টেনে অবস্থান ঠিক করুন
              </span>
            )}
          </div>
          <div className="mt-3 flex items-center justify-end gap-2">
            <button type="button" onClick={clearPending} disabled={busy} className="btn-ghost text-xs">বাতিল</button>
            <button type="button" onClick={save} disabled={busy} className="btn-primary text-xs">
              {busy ? 'প্রসেস হচ্ছে…' : '✓ সংরক্ষণ করুন'}
            </button>
          </div>
        </div>
      ) : value ? (
        /* ── বিদ্যমান ছবি: বদলান / সরান ── */
        <div className={`group relative overflow-hidden rounded-xl border-2 ${aspect}`} style={{ borderColor: 'var(--v-edge2)', background: 'var(--v-fill)' }}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={value} alt="" className="h-full w-full object-cover" />
          <div className="absolute inset-0 flex items-center justify-center gap-2 opacity-0 transition group-hover:opacity-100 focus-within:opacity-100" style={{ background: 'rgba(6,8,14,.7)' }}>
            <button type="button" onClick={() => inputRef.current?.click()} disabled={busy} className="btn-ghost text-xs">↻ বদলান</button>
            <button type="button" onClick={() => onChange(null)} className="btn-danger text-xs">✕ সরান</button>
          </div>
        </div>
      ) : (
        /* ── খালি: ড্রপ-জোন ── */
        <div
          role="button"
          tabIndex={0}
          aria-label={`${label || 'ছবি'} আপলোড করুন`}
          onClick={() => !busy && inputRef.current?.click()}
          onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); inputRef.current?.click(); } }}
          onPaste={(e) => {
            const item = Array.from(e.clipboardData.items).find((i) => i.type.startsWith('image/'));
            const f = item?.getAsFile();
            if (f) pick(f);
          }}
          onDragOver={(e) => { e.preventDefault(); setDrag(true); }}
          onDragLeave={() => setDrag(false)}
          onDrop={(e) => { e.preventDefault(); setDrag(false); const f = e.dataTransfer.files?.[0]; if (f) pick(f); }}
          className={`grid cursor-pointer place-items-center rounded-xl border-2 border-dashed p-6 text-center transition ${aspect} ${busy ? 'pointer-events-none opacity-60' : ''}`}
          style={{
            borderColor: drag ? 'var(--violet)' : 'var(--v-edge2)',
            background: drag ? 'var(--tint-violet)' : 'var(--v-fill)',
            transform: drag ? 'scale(1.01)' : undefined,
          }}
        >
          <div className="flex flex-col items-center gap-2">
            <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6"
              style={{ color: drag ? 'var(--violet)' : 'var(--v-dim)' }} aria-hidden="true">
              <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4" />
              <path d="M17 8l-5-5-5 5M12 3v12" />
            </svg>
            <p className="text-sm font-semibold" style={{ color: 'var(--v-ink)' }}>
              {drag ? 'ছেড়ে দিন' : 'ছবি টেনে আনুন বা ক্লিক করুন'}
            </p>
            <p className="text-[11px]" style={{ color: 'var(--v-dim)' }}>
              JPG · PNG · WebP · GIF — সর্বোচ্চ {MAX_MB} MB
            </p>
          </div>
        </div>
      )}

      {hint && <p className="mt-1.5 text-xs" style={{ color: 'var(--v-mut)' }}>{hint}</p>}

      <input
        ref={inputRef}
        type="file"
        accept={OK.join(',')}
        aria-label={label ? `${label} — ছবি নির্বাচন করুন` : 'ছবি নির্বাচন করুন'}
        className="sr-only"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) pick(f);
          e.target.value = '';
        }}
      />
    </div>
  );
}
