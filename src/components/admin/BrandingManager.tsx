'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useToast, ConfirmDialog } from '@/components/Toast';
import { processImage } from '@/lib/imageProcess';
import type { LogoSlot, LogoSlotKey, BrandTheme, Branding } from '@/lib/branding';

/**
 * ★★★ ব্র্যান্ড আইডেন্টিটি ব্যবস্থাপনা।
 *
 *   ছবি **ব্রাউজারেই** রিসাইজ/ক্রপ/কম্প্রেস হয় (`processImage`) তারপর
 *   আপলোড হয় — সার্ভারে বড় ফাইল যায়ই না, আর অ্যাডমিন সাথে সাথে ফল দেখে।
 *   সার্ভার তবু magic-byte যাচাই ও আকার-সীমা প্রয়োগ করে (ক্লায়েন্টকে
 *   কখনোই বিশ্বাস করা হয় না)।
 */

type Field = { key: string; label: string; hint: string; max: number };
type Props = {
  initial: Branding;
  raw: Record<string, string>;
  slots: LogoSlot[];
  fields: Field[];
};

const THEMES: BrandTheme[] = ['dark', 'light'];
const THEME_LABEL: Record<BrandTheme, string> = { dark: '🌙 ডার্ক', light: '☀️ লাইট' };
const MAX_UPLOAD = 8 * 1024 * 1024;
const OK_TYPES = ['image/png', 'image/jpeg', 'image/webp', 'image/svg+xml', 'image/gif'];

export default function BrandingManager({ initial, raw, slots, fields }: Props) {
  const toast = useToast();
  const router = useRouter();

  const [brand, setBrand] = useState<Branding>(initial);
  const [text, setText] = useState<Record<string, string>>(raw);
  const [busy, setBusy] = useState<string | null>(null);
  const [tab, setTab] = useState<'logos' | 'text' | 'preview'>('logos');
  const [confirmReset, setConfirmReset] = useState(false);
  const [previewDevice, setPreviewDevice] = useState<'desktop' | 'mobile'>('desktop');
  const [previewTheme, setPreviewTheme] = useState<BrandTheme>('dark');

  const dirtyText = fields.some((f) => (text[f.key] ?? '') !== (raw[f.key] ?? ''));

  const save = useCallback(async (payload: Record<string, unknown>, label: string, tag: string) => {
    setBusy(tag);
    try {
      const r = await fetch('/api/admin/branding', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || `${label} ব্যর্থ`);
      if (d.branding) setBrand(d.branding);
      toast.success(d.message || `${label} সংরক্ষিত`);
      router.refresh();
      return true;
    } catch (e) {
      toast.error(e instanceof Error ? e.message : `${label} ব্যর্থ`);
      return false;
    } finally { setBusy(null); }
  }, [toast, router]);

  /** ফাইল → যাচাই → ক্লায়েন্টে রিসাইজ/ক্রপ → আপলোড → সেটিংসে বসানো */
  const handleFile = useCallback(async (slot: LogoSlot, theme: BrandTheme, file: File) => {
    const tag = `${slot.key}-${theme}`;

    // ── ক্লায়েন্ট-সাইড যাচাই (সার্ভারেও আবার হয়) ──
    if (!OK_TYPES.includes(file.type)) {
      toast.error('শুধু PNG, JPEG, WebP, SVG বা GIF চলবে');
      return;
    }
    if (file.size > MAX_UPLOAD) {
      toast.error(`ফাইল বড় (${(file.size / 1048576).toFixed(1)} MB) — সর্বোচ্চ ৮ MB`);
      return;
    }

    setBusy(tag);
    try {
      const fd = new FormData();
      // ★ SVG ভেক্টর — ক্যানভাসে আঁকলে রাস্টারে পরিণত হয়ে মান নষ্ট হতো,
      //   তাই SVG সরাসরি পাঠাই; বাকিগুলো ক্রপ+রিসাইজ+কম্প্রেস করি।
      if (file.type === 'image/svg+xml') {
        fd.append('file', file);
      } else {
        const out = await processImage(file, {
          aspect: slot.aspect, maxSize: slot.max, quality: 0.9,
        });
        fd.append('file', out.file);
        if (out.width) fd.append('width', String(out.width));
        if (out.height) fd.append('height', String(out.height));
      }
      fd.append('folder', 'brand');

      const up = await fetch('/api/admin/upload', { method: 'POST', body: fd });
      const ud = await up.json();
      if (!up.ok) throw new Error(ud.error || 'আপলোড ব্যর্থ');

      await save({ logos: [{ slot: slot.key, theme, url: ud.url }] }, `${slot.label} (${THEME_LABEL[theme]})`, tag);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'আপলোড ব্যর্থ');
      setBusy(null);
    }
  }, [save, toast]);

  const currentLogo = (slot: LogoSlotKey, theme: BrandTheme) => brand.logos[slot]?.[theme] ?? '';

  return (
    <div className="space-y-5">
      {/* ═══ ট্যাব ═══ */}
      <div className="card p-2" role="tablist" aria-label="ব্র্যান্ডিং বিভাগ">
        <div className="flex flex-wrap gap-1">
          {([['logos', '🖼️ লোগো'], ['text', '✍️ ব্র্যান্ড তথ্য'], ['preview', '👁️ লাইভ প্রিভিউ']] as const).map(([id, label]) => (
            <button key={id} role="tab" aria-selected={tab === id} onClick={() => setTab(id)}
              className="rounded-lg px-3 py-2 text-[12px] font-bold transition"
              style={{
                background: tab === id ? 'var(--v-volt)' : 'transparent',
                color: tab === id ? 'var(--v-void)' : 'var(--v-mut)',
              }}>
              {label}
            </button>
          ))}
        </div>
      </div>

      {/* ═══════════ লোগো ═══════════ */}
      {tab === 'logos' && (
        <div className="space-y-3">
          <p className="text-[12px] leading-relaxed" style={{ color: 'var(--v-mut)' }}>
            শুধু <strong>প্রধান লোগো</strong> দিলেই পুরো সাইট ব্র্যান্ডেড হয়ে যাবে — বাকি স্লট
            খালি থাকলে সেটিই ব্যবহার হয়। কোনো লোগো না দিলে বিদ্যমান চিহ্ন দেখানো হবে।
            এক থিমের লোগো দিলে অন্য থিমেও সেটিই চলবে।
          </p>

          {slots.map((slot) => (
            <div key={slot.key} className="card p-3.5 sm:p-4">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <div className="min-w-0">
                  <h3 className="text-[13.5px] font-bold" style={{ color: 'var(--v-ink)' }}>{slot.label}</h3>
                  <p className="text-[11px]" style={{ color: 'var(--v-dim)' }}>{slot.hint}</p>
                </div>
                <span className="rounded px-2 py-0.5 text-[10px] font-semibold"
                  style={{ background: 'var(--v-steel)', color: 'var(--v-mut)' }}>
                  {slot.usedIn}
                </span>
              </div>

              <div className="mt-3 grid gap-3 sm:grid-cols-2">
                {THEMES.map((theme) => (
                  <LogoDrop
                    key={theme}
                    slot={slot}
                    theme={theme}
                    url={currentLogo(slot.key, theme)}
                    busy={busy === `${slot.key}-${theme}`}
                    onFile={(f) => handleFile(slot, theme, f)}
                    onDelete={() => save({ logos: [{ slot: slot.key, theme, url: null }] }, `${slot.label} মুছে ফেলা`, `${slot.key}-${theme}`)}
                  />
                ))}
              </div>
            </div>
          ))}

          <div className="card p-4">
            <button onClick={() => setConfirmReset(true)} disabled={busy !== null}
              className="btn-ghost px-4 py-2 text-xs font-bold disabled:opacity-50"
              style={{ color: 'var(--v-heat)' }}>
              🗑️ সব ব্র্যান্ডিং ডিফল্টে ফেরান
            </button>
            <p className="mt-1.5 text-[11px]" style={{ color: 'var(--v-dim)' }}>
              সব লোগো ও ব্র্যান্ড-লেখা মুছে যাবে এবং আপলোড করা ফাইলগুলোও সরানো হবে।
              সাইটের নাম ও URL অক্ষত থাকবে।
            </p>
          </div>
        </div>
      )}

      {/* ═══════════ টেক্সট ═══════════ */}
      {tab === 'text' && (
        <div className="card space-y-3 p-4 sm:p-5">
          <p className="text-[12px]" style={{ color: 'var(--v-mut)' }}>
            খালি রাখলে সংবেদনশীল ডিফল্ট ব্যবহার হবে (যেমন কপিরাইট নিজে থেকেই তৈরি হয়)।
          </p>
          <div className="grid gap-3 sm:grid-cols-2">
            {fields.map((f) => {
              const long = ['brand_meta_description', 'brand_og_description', 'brand_footer_text', 'brand_keywords'].includes(f.key);
              const val = text[f.key] ?? '';
              return (
                <div key={f.key} className={long ? 'sm:col-span-2' : ''}>
                  <label className="label" htmlFor={`bf-${f.key}`}>{f.label}</label>
                  {long ? (
                    <textarea id={`bf-${f.key}`} rows={2} className="input" maxLength={f.max}
                      value={val} onChange={(e) => setText({ ...text, [f.key]: e.target.value })} />
                  ) : (
                    <input id={`bf-${f.key}`} className="input" maxLength={f.max}
                      value={val} onChange={(e) => setText({ ...text, [f.key]: e.target.value })} />
                  )}
                  <p className="mt-0.5 flex justify-between gap-2 text-[10.5px]" style={{ color: 'var(--v-dim)' }}>
                    <span>{f.hint}</span>
                    <span className="tabular-nums shrink-0">{val.length}/{f.max}</span>
                  </p>
                </div>
              );
            })}
          </div>
          <div className="flex items-center gap-3">
            <button onClick={() => save({ text }, 'ব্র্যান্ড তথ্য', 'text')}
              disabled={busy !== null || !dirtyText}
              className="btn-primary wz-cta px-5 py-2 text-xs font-bold disabled:opacity-50">
              {busy === 'text' ? 'সেভ হচ্ছে…' : 'সংরক্ষণ'}
            </button>
            {dirtyText && <span className="text-[11.5px]" style={{ color: 'var(--v-mut)' }}>অসংরক্ষিত পরিবর্তন আছে</span>}
          </div>
        </div>
      )}

      {/* ═══════════ লাইভ প্রিভিউ ═══════════ */}
      {tab === 'preview' && (
        <div className="space-y-3">
          <div className="card flex flex-wrap items-center gap-2 p-3">
            <span className="text-[12px] font-bold" style={{ color: 'var(--v-ink)' }}>ডিভাইস</span>
            {(['desktop', 'mobile'] as const).map((d) => (
              <button key={d} onClick={() => setPreviewDevice(d)} aria-pressed={previewDevice === d}
                className="rounded-full px-3 py-1.5 text-[11.5px] font-semibold"
                style={{
                  background: previewDevice === d ? 'var(--v-volt)' : 'var(--v-steel)',
                  color: previewDevice === d ? 'var(--v-void)' : 'var(--v-mut)',
                }}>
                {d === 'desktop' ? '🖥️ ডেস্কটপ' : '📱 মোবাইল'}
              </button>
            ))}
            <span className="ml-3 text-[12px] font-bold" style={{ color: 'var(--v-ink)' }}>থিম</span>
            {THEMES.map((t) => (
              <button key={t} onClick={() => setPreviewTheme(t)} aria-pressed={previewTheme === t}
                className="rounded-full px-3 py-1.5 text-[11.5px] font-semibold"
                style={{
                  background: previewTheme === t ? 'var(--v-volt)' : 'var(--v-steel)',
                  color: previewTheme === t ? 'var(--v-void)' : 'var(--v-mut)',
                }}>
                {THEME_LABEL[t]}
              </button>
            ))}
          </div>

          <BrandPreview
            brand={brand}
            text={text}
            device={previewDevice}
            theme={previewTheme}
          />
        </div>
      )}

      <ConfirmDialog
        open={confirmReset}
        title="সব ব্র্যান্ডিং ডিফল্টে ফেরাবেন?"
        message="সব আপলোড করা লোগো ও ব্র্যান্ড-লেখা মুছে যাবে, ফাইলগুলোও স্টোরেজ থেকে সরানো হবে। এটি ফেরানো যাবে না।"
        confirmLabel="হ্যাঁ, রিসেট করুন"
        onCancel={() => setConfirmReset(false)}
        onConfirm={async () => {
          setConfirmReset(false);
          const ok = await save({ action: 'reset-all' }, 'রিসেট', 'reset');
          if (ok) { setText({}); router.refresh(); }
        }}
      />
    </div>
  );
}

/* ─────────────────── একটি স্লট+থিমের ড্রপ-জোন ─────────────────── */
function LogoDrop({ slot, theme, url, busy, onFile, onDelete }: {
  slot: LogoSlot; theme: BrandTheme; url: string; busy: boolean;
  onFile: (f: File) => void; onDelete: () => void;
}) {
  const [over, setOver] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const id = `logo-${slot.key}-${theme}`;

  return (
    <div>
      <p className="mb-1 text-[11.5px] font-bold" style={{ color: 'var(--v-mut)' }}>
        {THEME_LABEL[theme]}
      </p>
      <div
        onDragOver={(e) => { e.preventDefault(); setOver(true); }}
        onDragLeave={() => setOver(false)}
        onDrop={(e) => {
          e.preventDefault(); setOver(false);
          const f = e.dataTransfer.files?.[0];
          if (f) onFile(f);
        }}
        className="relative flex min-h-[104px] flex-col items-center justify-center gap-2 rounded-xl p-3 transition"
        style={{
          // ★ প্রিভিউ পটভূমি ঐ থিমের রঙে — সাদা লোগো সাদা ঘরে
          //   অদৃশ্য হয়ে যেত, তাই যাচাই করা অসম্ভব হতো।
          background: theme === 'dark' ? '#0a0b11' : '#f4f6fb',
          border: `1.5px dashed ${over ? 'var(--v-volt)' : 'var(--v-edge)'}`,
        }}
      >
        {busy ? (
          <span className="text-[11.5px] font-semibold" style={{ color: theme === 'dark' ? '#eef1f6' : '#0f1729' }}>
            <span className="wz-orbit" aria-hidden /> প্রক্রিয়াজাত হচ্ছে…
          </span>
        ) : url ? (
          <>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={url} alt={`${slot.label} — ${THEME_LABEL[theme]}`}
              className="max-h-[64px] w-auto max-w-full object-contain" />
            <div className="flex gap-1.5">
              <button onClick={() => inputRef.current?.click()}
                className="rounded px-2 py-1 text-[10.5px] font-bold"
                style={{ background: 'var(--v-steel)', color: 'var(--v-ink)' }}>
                বদলান
              </button>
              <button onClick={onDelete}
                className="rounded px-2 py-1 text-[10.5px] font-bold"
                style={{ background: 'var(--v-steel)', color: 'var(--v-heat)' }}>
                মুছুন
              </button>
            </div>
          </>
        ) : (
          <>
            <span className="text-[11.5px]" style={{ color: theme === 'dark' ? '#8b94a7' : '#5b6472' }}>
              টেনে আনুন, বা
            </span>
            <button onClick={() => inputRef.current?.click()}
              className="rounded px-3 py-1.5 text-[11px] font-bold"
              style={{ background: 'var(--v-volt)', color: 'var(--v-void)' }}>
              ফাইল বাছুন
            </button>
          </>
        )}

        <input
          ref={inputRef} id={id} type="file" className="sr-only"
          accept="image/png,image/jpeg,image/webp,image/svg+xml,image/gif"
          aria-label={`${slot.label} — ${THEME_LABEL[theme]} আপলোড`}
          onChange={(e) => { const f = e.target.files?.[0]; if (f) onFile(f); e.target.value = ''; }}
        />
      </div>
      <p className="mt-1 text-[10px]" style={{ color: 'var(--v-dim)' }}>
        সর্বোচ্চ {slot.max}px{slot.aspect ? ` · ${slot.aspect === 1 ? '১:১' : 'নির্দিষ্ট অনুপাতে'} ক্রপ` : ' · মুক্ত অনুপাত'} · PNG/JPEG/WebP/SVG
      </p>
    </div>
  );
}

/* ─────────────────── লাইভ প্রিভিউ ─────────────────── */
function BrandPreview({ brand, text, device, theme }: {
  brand: Branding; text: Record<string, string>; device: 'desktop' | 'mobile'; theme: BrandTheme;
}) {
  const name = (text.site_name || brand.siteName).trim();
  const short = (text.brand_short_name || brand.shortName).trim();
  const copyright = (text.brand_copyright || brand.copyright).trim();
  const metaTitle = (text.brand_meta_title || brand.metaTitle).trim();
  const metaDesc = (text.brand_meta_description || brand.metaDescription).trim();
  const ogTitle = (text.brand_og_title || brand.ogTitle).trim();
  const ogDesc = (text.brand_og_description || brand.ogDescription).trim();

  const bg = theme === 'dark' ? '#0a0b11' : '#f4f6fb';
  const ink = theme === 'dark' ? '#eef1f6' : '#0f1729';
  const mut = theme === 'dark' ? '#8b94a7' : '#5b6472';
  const panel = theme === 'dark' ? '#141721' : '#ffffff';
  const edge = theme === 'dark' ? '#232838' : '#dfe4ee';

  const pick = (slot: LogoSlotKey) => brand.logos[slot]?.[theme] || '';
  const Logo = ({ slot, h }: { slot: LogoSlotKey; h: number }) => {
    const src = pick(slot);
    return src
      // eslint-disable-next-line @next/next/no-img-element
      ? <img src={src} alt="" style={{ height: h, width: 'auto' }} className="object-contain" />
      : <span style={{ fontSize: h * 0.5, fontWeight: 800, color: ink, letterSpacing: '-.02em' }}>{name}</span>;
  };

  const width = device === 'mobile' ? 390 : 900;

  return (
    <div className="card overflow-x-auto p-4">
      <div className="mx-auto" style={{ width, maxWidth: '100%' }}>
        {/* ব্রাউজার ট্যাব */}
        <div className="flex items-center gap-2 rounded-t-lg px-3 py-2"
          style={{ background: edge }}>
          <span className="flex items-center gap-1.5 rounded-t px-2.5 py-1.5"
            style={{ background: panel, maxWidth: 260 }}>
            {pick('favicon')
              // eslint-disable-next-line @next/next/no-img-element
              ? <img src={pick('favicon')} alt="" style={{ height: 14, width: 14 }} className="rounded-sm object-contain" />
              : <span style={{ width: 14, height: 14, borderRadius: 3, background: 'var(--v-volt)' }} />}
            <span className="truncate text-[10.5px]" style={{ color: ink }}>
              {(text.brand_browser_title || brand.browserTitle || name)}
            </span>
          </span>
        </div>

        {/* সাইট */}
        <div style={{ background: bg, border: `1px solid ${edge}`, borderTop: 'none' }}>
          {/* নেভ */}
          <div className="flex items-center justify-between gap-3 px-4 py-3"
            style={{ borderBottom: `1px solid ${edge}` }}>
            <span className="flex items-center gap-2">
              <Logo slot={device === 'mobile' ? 'compact' : 'primary'} h={device === 'mobile' ? 26 : 32} />
            </span>
            {device === 'desktop' && (
              <span className="flex gap-3 text-[11px]" style={{ color: mut }}>
                <span>হোম</span><span>প্রোডাক্ট</span><span>ট্র্যাক</span>
              </span>
            )}
          </div>

          {/* লগইন কার্ড */}
          <div className="px-4 py-6">
            <div className="mx-auto flex max-w-[300px] flex-col items-center gap-2 rounded-xl p-4"
              style={{ background: panel, border: `1px solid ${edge}` }}>
              <Logo slot="login" h={38} />
              <p className="text-[12px] font-bold" style={{ color: ink }}>লগইন করুন</p>
              <span className="h-7 w-full rounded" style={{ background: bg, border: `1px solid ${edge}` }} />
              <span className="h-7 w-full rounded" style={{ background: bg, border: `1px solid ${edge}` }} />
              <span className="mt-1 h-7 w-full rounded" style={{ background: 'var(--v-volt)' }} />
            </div>
          </div>

          {/* লোডিং ওভারলে */}
          <div className="mx-4 mb-4 flex items-center justify-center gap-2 rounded-xl py-5"
            style={{ background: panel, border: `1px dashed ${edge}` }}>
            <Logo slot="loading" h={30} />
            <span className="text-[11px]" style={{ color: mut }}>লোড হচ্ছে…</span>
          </div>

          {/* ফুটার */}
          <div className="flex flex-col items-center gap-1 px-4 py-4"
            style={{ borderTop: `1px solid ${edge}` }}>
            <Logo slot="secondary" h={24} />
            {(text.brand_footer_text || brand.footerText) && (
              <p className="text-center text-[10.5px]" style={{ color: mut }}>
                {text.brand_footer_text || brand.footerText}
              </p>
            )}
            <p className="text-[10px]" style={{ color: mut }}>{copyright}</p>
          </div>
        </div>

        {/* শেয়ার কার্ড + PWA */}
        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          <div>
            <p className="mb-1 text-[11px] font-bold" style={{ color: 'var(--v-mut)' }}>সোশ্যাল শেয়ার কার্ড</p>
            <div className="overflow-hidden rounded-lg" style={{ border: `1px solid ${edge}`, background: panel }}>
              <div className="flex items-center justify-center" style={{ height: 96, background: bg }}>
                {pick('og')
                  // eslint-disable-next-line @next/next/no-img-element
                  ? <img src={pick('og')} alt="" className="h-full w-full object-cover" />
                  : <span className="text-[11px]" style={{ color: mut }}>OG ছবি নেই</span>}
              </div>
              <div className="p-2">
                <p className="truncate text-[11px] font-bold" style={{ color: ink }}>{ogTitle}</p>
                <p className="line-clamp-2 text-[10px]" style={{ color: mut }}>{ogDesc}</p>
              </div>
            </div>
          </div>

          <div>
            <p className="mb-1 text-[11px] font-bold" style={{ color: 'var(--v-mut)' }}>PWA / হোম-স্ক্রিন</p>
            <div className="flex items-center gap-3 rounded-lg p-3" style={{ border: `1px solid ${edge}`, background: panel }}>
              <span className="grid place-items-center overflow-hidden rounded-[14px]"
                style={{ width: 48, height: 48, background: bg, border: `1px solid ${edge}` }}>
                {pick('pwa')
                  // eslint-disable-next-line @next/next/no-img-element
                  ? <img src={pick('pwa')} alt="" className="h-full w-full object-contain p-1" />
                  : <span className="text-[9px]" style={{ color: mut }}>আইকন</span>}
              </span>
              <span className="min-w-0">
                <span className="block truncate text-[11.5px] font-bold" style={{ color: ink }}>{short}</span>
                <span className="block truncate text-[10px]" style={{ color: mut }}>
                  {text.brand_manifest_name || brand.manifestName}
                </span>
              </span>
            </div>
          </div>
        </div>

        {/* SEO */}
        <div className="mt-3 rounded-lg p-3" style={{ border: `1px solid ${edge}`, background: panel }}>
          <p className="mb-1 text-[11px] font-bold" style={{ color: 'var(--v-mut)' }}>সার্চ ফলাফল</p>
          <p className="truncate text-[12.5px]" style={{ color: theme === 'dark' ? '#8ab4f8' : '#1a0dab' }}>{metaTitle}</p>
          <p className="text-[10px]" style={{ color: theme === 'dark' ? '#6b8043' : '#006621' }}>
            {brand.siteUrl || 'https://example.com'}
          </p>
          <p className="line-clamp-2 text-[10.5px]" style={{ color: mut }}>{metaDesc}</p>
        </div>
      </div>
    </div>
  );
}
