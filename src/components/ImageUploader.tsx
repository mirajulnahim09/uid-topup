'use client';

import { useCallback, useRef, useState } from 'react';
import { useToast } from './Toast';

/**
 * ★ Drag & drop ছবি আপলোডার
 *   - টেনে আনা, ক্লিক, paste (Ctrl+V) — তিন ভাবেই কাজ করে
 *   - keyboard accessible (Enter / Space)
 *   - client-side check + server এ magic-byte check
 */
const MAX_MB = 8;
const OK = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];

export default function ImageUploader({
  value, onChange, folder = 'site', label = 'ছবি',
  hint, aspect = 'aspect-video', endpoint = '/api/admin/upload',
}: {
  value: string | null;
  onChange: (url: string | null) => void;
  folder?: string;
  label?: string;
  hint?: string;
  aspect?: string;
  endpoint?: string;
}) {
  const toast = useToast();
  const inputRef = useRef<HTMLInputElement>(null);
  const [drag, setDrag] = useState(false);
  const [busy, setBusy] = useState(false);

  const upload = useCallback(
    async (file: File) => {
      if (!OK.includes(file.type)) {
        toast.error('শুধু JPG, PNG, WebP বা GIF ছবি দিন');
        return;
      }
      if (file.size > MAX_MB * 1024 * 1024) {
        toast.error(
          `ছবি ${MAX_MB} MB এর কম হতে হবে (আপনারটি ${(file.size / 1048576).toFixed(1)} MB)`
        );
        return;
      }

      setBusy(true);
      try {
        const fd = new FormData();
        fd.append('file', file);
        fd.append('folder', folder);

        const res = await fetch(endpoint, { method: 'POST', body: fd });
        const d = await res.json();
        if (!res.ok) throw new Error(d.error || 'আপলোড ব্যর্থ');

        onChange(d.url);
        toast.success('ছবি আপলোড হয়েছে');
      } catch (e) {
        toast.error(e instanceof Error ? e.message : 'আপলোড ব্যর্থ');
      } finally {
        setBusy(false);
      }
    },
    [folder, endpoint, onChange, toast]
  );

  return (
    <div>
      {label && <label className="label">{label}</label>}

      {value ? (
        <div className={`group relative overflow-hidden rounded-xl border-2 border-slate-200 bg-slate-50 ${aspect}`}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={value} alt="" className="h-full w-full object-cover" />
          <div className="absolute inset-0 flex items-center justify-center gap-2 bg-slate-900/70 opacity-0 transition group-hover:opacity-100 focus-within:opacity-100">
            <button
              type="button"
              onClick={() => inputRef.current?.click()}
              disabled={busy}
              className="btn-ghost text-xs"
            >
              {busy ? 'আপলোড...' : '↻ বদলান'}
            </button>
            <button type="button" onClick={() => onChange(null)} className="btn-danger text-xs">
              ✕ সরান
            </button>
          </div>
        </div>
      ) : (
        <div
          role="button"
          tabIndex={0}
          aria-label={`${label || 'ছবি'} আপলোড করুন`}
          onClick={() => !busy && inputRef.current?.click()}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault();
              inputRef.current?.click();
            }
          }}
          onPaste={(e) => {
            const item = Array.from(e.clipboardData.items).find((i) =>
              i.type.startsWith('image/')
            );
            const f = item?.getAsFile();
            if (f) upload(f);
          }}
          onDragOver={(e) => {
            e.preventDefault();
            setDrag(true);
          }}
          onDragLeave={() => setDrag(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDrag(false);
            const f = e.dataTransfer.files?.[0];
            if (f) upload(f);
          }}
          className={`grid cursor-pointer place-items-center rounded-xl border-2 border-dashed p-6 text-center transition ${aspect} ${
            drag
              ? 'scale-[1.01] border-rose-400 bg-rose-50'
              : 'border-slate-300 bg-slate-50 hover:border-rose-400 hover:bg-rose-50/50'
          } ${busy ? 'pointer-events-none opacity-60' : ''}`}
        >
          {busy ? (
            <div className="flex flex-col items-center gap-2">
              <div className="h-6 w-6 animate-spin rounded-full border-2 border-rose-500 border-t-transparent" />
              <p className="text-xs text-slate-500">আপলোড হচ্ছে...</p>
            </div>
          ) : (
            <div className="flex flex-col items-center gap-2">
              <svg
                width="28" height="28" viewBox="0 0 24 24" fill="none"
                stroke="currentColor" strokeWidth="1.6"
                className={drag ? 'text-rose-500' : 'text-slate-400'}
                aria-hidden="true"
              >
                <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4" />
                <path d="M17 8l-5-5-5 5M12 3v12" />
              </svg>
              <p className="text-sm font-semibold text-slate-700">
                {drag ? 'ছেড়ে দিন' : 'ছবি টেনে আনুন বা ক্লিক করুন'}
              </p>
              <p className="text-[11px] text-slate-400">
                JPG · PNG · WebP · GIF — সর্বোচ্চ {MAX_MB} MB
              </p>
            </div>
          )}
        </div>
      )}

      {hint && <p className="mt-1.5 text-xs text-slate-500">{hint}</p>}

      <input
        ref={inputRef}
        type="file"
        accept={OK.join(',')}
        className="sr-only"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) upload(f);
          e.target.value = ''; // একই ফাইল আবার দিলেও trigger হবে
        }}
      />
    </div>
  );
}
