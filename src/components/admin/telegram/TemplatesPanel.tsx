'use client';

import { useEffect, useState, useCallback, useRef } from 'react';
import { useToast } from '@/components/Toast';
import LoadFailedCard from '@/components/admin/LoadFailedCard';

/**
 * ★ বার্তা টেমপ্লেট — {{চলক}} সহ, লাইভ প্রিভিউ।
 *
 *   প্রিভিউ **সার্ভারে** রেন্ডার হয় (একই `render()` ফাংশন যা আসল
 *   বার্তায় চলে), তাই অ্যাডমিন ঠিক সেটাই দেখে যা টেলিগ্রামে যাবে।
 *   ক্লায়েন্টে আলাদা করে রেন্ডার করলে দুই জায়গায় দুই রকম যুক্তি হতো।
 */

type Tpl = {
  key: string; label: string; body: string; enabled: boolean; isDefault: boolean;
  vars: { key: string; label: string; sample: string }[];
  preview: string;
};

export default function TemplatesPanel() {
  const toast = useToast();
  const [list, setList] = useState<Tpl[]>([]);
  const [active, setActive] = useState<string | null>(null);
  const [body, setBody] = useState('');
  const [preview, setPreview] = useState('');
  const [busy, setBusy] = useState(false);
  const areaRef = useRef<HTMLTextAreaElement>(null);
  const debounce = useRef<NodeJS.Timeout | null>(null);
  // An empty list used to mean "loading" forever, even after a failed fetch or
  // when no templates exist; track the fetch state explicitly.
  const [loadState, setLoadState] = useState<'loading' | 'ok' | 'failed'>('loading');

  const load = useCallback(async () => {
    try {
      const r = await fetch('/api/admin/telegram/templates');
      if (!r.ok) throw new Error();
      const d = await r.json();
      setList(d.templates ?? []);
      if (!active && d.templates?.[0]) {
        setActive(d.templates[0].key);
        setBody(d.templates[0].body);
        setPreview(d.templates[0].preview);
      }
      setLoadState('ok');
    } catch { setLoadState((s) => (s === 'ok' ? s : 'failed')); toast.error('টেমপ্লেট আনা যায়নি'); }
  }, [toast, active]);

  useEffect(() => { void load(); }, [load]);

  const current = list.find((t) => t.key === active) ?? null;

  function select(t: Tpl) {
    setActive(t.key); setBody(t.body); setPreview(t.preview);
  }

  /** ★ টাইপ করার সময় প্রতিটি অক্ষরে অনুরোধ নয় — ৩৫০ms থামলে একবার */
  function onBodyChange(v: string) {
    setBody(v);
    if (debounce.current) clearTimeout(debounce.current);
    debounce.current = setTimeout(async () => {
      if (!active) return;
      try {
        const r = await fetch('/api/admin/telegram/templates', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'preview', key: active, body: v }),
        });
        if (r.ok) setPreview((await r.json()).preview);
      } catch { /* প্রিভিউ ব্যর্থ হলে আগেরটাই থাকুক */ }
    }, 350);
  }

  /** কার্সারের জায়গায় চলক বসানো */
  function insertVar(v: string) {
    const el = areaRef.current;
    const token = `{{${v}}}`;
    if (!el) { onBodyChange(body + token); return; }
    const s = el.selectionStart ?? body.length;
    const e = el.selectionEnd ?? body.length;
    const next = body.slice(0, s) + token + body.slice(e);
    onBodyChange(next);
    requestAnimationFrame(() => {
      el.focus();
      el.setSelectionRange(s + token.length, s + token.length);
    });
  }

  async function save() {
    if (!active) return;
    setBusy(true);
    try {
      const r = await fetch('/api/admin/telegram/templates', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'save', key: active, body, enabled: true }),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || 'সেভ ব্যর্থ');
      toast.success('টেমপ্লেট সংরক্ষিত');
      setPreview(d.preview);
      await load();
    } catch (e) { toast.error(e instanceof Error ? e.message : 'সেভ ব্যর্থ'); }
    finally { setBusy(false); }
  }

  async function reset() {
    if (!active) return;
    setBusy(true);
    try {
      const r = await fetch('/api/admin/telegram/templates', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'reset', key: active }),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || 'রিসেট ব্যর্থ');
      setBody(d.body); setPreview(d.preview);
      toast.success('ডিফল্টে ফেরানো হয়েছে');
      await load();
    } catch (e) { toast.error(e instanceof Error ? e.message : 'রিসেট ব্যর্থ'); }
    finally { setBusy(false); }
  }

  if (list.length === 0) {
    if (loadState === 'failed') return <LoadFailedCard what="টেমপ্লেট" onRetry={() => { setLoadState('loading'); void load(); }} />;
    if (loadState === 'ok') return <div className="card p-5 text-[13px]" style={{ color: 'var(--v-mut)' }}>কোনো টেমপ্লেট নেই।</div>;
    return <div className="card p-5 text-[13px]" style={{ color: 'var(--v-mut)' }}>লোড হচ্ছে…</div>;
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-1.5">
        {list.map((t) => (
          <button key={t.key} onClick={() => select(t)}
            aria-pressed={active === t.key}
            className="rounded-full px-3 py-1.5 text-[11.5px] font-semibold transition"
            style={{
              background: active === t.key ? 'var(--v-volt)' : 'var(--v-steel)',
              color: active === t.key ? 'var(--v-void)' : 'var(--v-mut)',
            }}>
            {t.label}{!t.isDefault && ' •'}
          </button>
        ))}
      </div>

      {current && (
        <div className="grid gap-4 lg:grid-cols-2">
          {/* ── সম্পাদক ── */}
          <div className="card p-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h3 className="text-[14px] font-bold" style={{ color: 'var(--v-ink)' }}>{current.label}</h3>
              {!current.isDefault && (
                <span className="rounded px-1.5 py-0.5 text-[10px] font-bold"
                  style={{ background: 'var(--tint-volt)', color: 'var(--v-ink)' }}>কাস্টম</span>
              )}
            </div>

            <label className="label mt-2" htmlFor="tpl-body">বার্তার শরীর</label>
            <textarea id="tpl-body" ref={areaRef} rows={9}
              className="input font-mono text-[12.5px]"
              value={body} onChange={(e) => onBodyChange(e.target.value)}
              spellCheck={false} />

            <p className="mt-2 text-[11px] font-bold" style={{ color: 'var(--v-mut)' }}>চলক — ক্লিক করে বসান</p>
            <div className="mt-1 flex flex-wrap gap-1.5">
              {current.vars.map((v) => (
                <button key={v.key} type="button" onClick={() => insertVar(v.key)}
                  title={`${v.label} — যেমন: ${v.sample}`}
                  className="rounded px-2 py-1 font-mono text-[10.5px] font-semibold transition hover:opacity-80"
                  style={{ background: 'var(--v-steel)', color: 'var(--v-ice)' }}>
                  {'{{'}{v.key}{'}}'}
                </button>
              ))}
            </div>
            <p className="mt-1.5 text-[10.5px]" style={{ color: 'var(--v-dim)' }}>
              অচেনা <code>{'{{চলক}}'}</code> অপরিবর্তিত থাকে — নীরবে ফাঁকা হয়ে গেলে বানান ভুল ধরা পড়ত না।
              <code>&lt;b&gt;</code>, <code>&lt;i&gt;</code>, <code>&lt;code&gt;</code> ব্যবহার করা যায়।
            </p>

            <div className="mt-3 flex flex-wrap gap-2">
              <button onClick={reset} disabled={busy || current.isDefault}
                className="btn-ghost px-4 py-2 text-xs font-bold disabled:opacity-40">
                ↺ ডিফল্টে ফেরান
              </button>
              <button onClick={save} disabled={busy || body === current.body}
                className="btn-primary wz-cta ml-auto px-5 py-2 text-xs font-bold disabled:opacity-50">
                {busy ? 'সেভ হচ্ছে…' : 'সংরক্ষণ'}
              </button>
            </div>
          </div>

          {/* ── লাইভ প্রিভিউ ── */}
          <div className="card p-4">
            <h3 className="text-[14px] font-bold" style={{ color: 'var(--v-ink)' }}>লাইভ প্রিভিউ</h3>
            <p className="mt-0.5 text-[11px]" style={{ color: 'var(--v-dim)' }}>
              নমুনা মান বসিয়ে দেখানো হচ্ছে — টেলিগ্রামে ঠিক এভাবেই যাবে।
            </p>
            <div className="mt-2 rounded-xl p-3.5" style={{ background: 'var(--v-steel)' }}>
              <div className="flex items-start gap-2">
                <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full text-base"
                  style={{ background: 'var(--v-pit)' }}>🤖</span>
                <div
                  className="min-w-0 whitespace-pre-wrap break-words text-[12.5px] leading-relaxed"
                  style={{ color: 'var(--v-ink)' }}
                  // ★ প্রিভিউ সার্ভারে রেন্ডার — চলকের মান সেখানেই esc() করা,
                  //   তাই গ্রাহকের নামে <script> থাকলেও এখানে টেক্সট হিসেবেই দেখাবে।
                  dangerouslySetInnerHTML={{ __html: preview }}
                />
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
