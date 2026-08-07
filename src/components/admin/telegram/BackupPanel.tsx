'use client';

import { useState } from 'react';
import { useToast } from '@/components/Toast';

/**
 * ★★★ ব্যাকআপ ও পুনরুদ্ধার।
 *
 *   প্রবাহ: ফাইল বাছাই → **যাচাই** (কিছুই লেখে না) → প্রিভিউ দেখা →
 *   স্পষ্ট নিশ্চিতকরণ → পুনরুদ্ধার। নিশ্চিতকরণ ছাড়া সার্ভার প্রয়োগ
 *   করতেই অস্বীকার করে (`confirm:true` বাধ্যতামূলক)।
 */

type Issue = { level: 'error' | 'warning'; message: string };
type Validation = {
  valid: boolean;
  issues: Issue[];
  preview: {
    version: number; exportedAt: string; secretsIncluded: boolean;
    bots: { label: string; role: string; chatIdMasked: string; events: number; hasToken: boolean }[];
    events: { enabled: number; total: number };
    templates: number; jobs: number;
  } | null;
  willReplace: { bots: number; templates: number; jobs: number } | null;
};

export default function BackupPanel() {
  const toast = useToast();

  const [exportPass, setExportPass] = useState('');
  const [importPass, setImportPass] = useState('');
  const [file, setFile] = useState<unknown>(null);
  const [fileName, setFileName] = useState('');
  const [check, setCheck] = useState<Validation | null>(null);
  const [replace, setReplace] = useState(false);
  const [deep, setDeep] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);

  function download() {
    if (exportPass && exportPass.length < 8) {
      toast.error('পাসফ্রেজ কমপক্ষে ৮ অক্ষরের হতে হবে');
      return;
    }
    const q = exportPass ? `?passphrase=${encodeURIComponent(exportPass)}` : '';
    window.location.href = `/api/admin/telegram/backup${q}`;
    toast.success(exportPass ? 'ব্যাকআপ নামছে — টোকেন সিল করা আছে' : 'ব্যাকআপ নামছে — টোকেন ছাড়া');
  }

  async function pick(f: File) {
    setFileName(f.name); setCheck(null);
    try {
      const parsed = JSON.parse(await f.text());
      setFile(parsed);
    } catch {
      setFile(null);
      toast.error('ফাইলটি বৈধ JSON নয় — সম্ভবত বিকৃত');
    }
  }

  async function validate() {
    if (!file) { toast.error('আগে ফাইল বাছুন'); return; }
    setBusy('validate');
    try {
      const r = await fetch('/api/admin/telegram/backup', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'validate', file, passphrase: importPass || undefined, deep }),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || 'যাচাই ব্যর্থ');
      setCheck(d);
      if (d.valid) toast.success('যাচাই সফল — নিচে প্রিভিউ দেখুন');
      else toast.error('ব্যাকআপে সমস্যা আছে');
    } catch (e) { toast.error(e instanceof Error ? e.message : 'যাচাই ব্যর্থ'); }
    finally { setBusy(null); }
  }

  async function restore() {
    if (!file || !check?.valid) return;
    setBusy('restore');
    try {
      const r = await fetch('/api/admin/telegram/backup', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'restore', file, passphrase: importPass || undefined,
          confirm: true, replace,
        }),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || 'পুনরুদ্ধার ব্যর্থ');
      toast.success(d.message || 'পুনরুদ্ধার সম্পন্ন');
      setCheck(null); setFile(null); setFileName(''); setImportPass('');
    } catch (e) { toast.error(e instanceof Error ? e.message : 'পুনরুদ্ধার ব্যর্থ'); }
    finally { setBusy(null); }
  }

  const errors = check?.issues.filter((i) => i.level === 'error') ?? [];
  const warnings = check?.issues.filter((i) => i.level === 'warning') ?? [];

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      {/* ═══ এক্সপোর্ট ═══ */}
      <div className="card p-4 sm:p-5">
        <h3 className="text-[15px] font-bold" style={{ color: 'var(--v-ink)' }}>ব্যাকআপ ডাউনলোড</h3>
        <p className="mt-1 text-[12px] leading-relaxed" style={{ color: 'var(--v-mut)' }}>
          বট কনফিগ, চ্যাট, নোটিফিকেশন পছন্দ, ইভেন্ট নিয়ম, টেমপ্লেট ও শিডিউলার —
          সবই একটি JSON ফাইলে।
        </p>

        <label className="label mt-3" htmlFor="bk-pass">পাসফ্রেজ (ঐচ্ছিক)</label>
        <input id="bk-pass" type="password" className="input" value={exportPass}
          autoComplete="new-password"
          onChange={(e) => setExportPass(e.target.value)}
          placeholder="কমপক্ষে ৮ অক্ষর — দিলে টোকেনও ব্যাকআপে যাবে" />

        <p className="mt-1.5 rounded-lg p-2.5 text-[11px] leading-relaxed"
          style={{ background: 'var(--tint-ice)', color: 'var(--v-ink)' }}>
          🔒 পাসফ্রেজ <b>না দিলে</b> টোকেন ব্যাকআপে থাকে না (নিরাপদ, কিন্তু পুনরুদ্ধারের পর
          টোকেন হাতে বসাতে হবে)। <b>দিলে</b> টোকেন এই পাসফ্রেজ দিয়ে আলাদাভাবে এনক্রিপ্ট হয় —
          ফাইল পেলেও পাসফ্রেজ ছাড়া পড়া যায় না। পাসফ্রেজ কোথাও সংরক্ষিত হয় না, তাই হারালে
          সেই ব্যাকআপের টোকেন আর ফেরানো যাবে না।
        </p>

        <button onClick={download} className="btn-primary wz-cta mt-3 w-full px-5 py-2.5 text-xs font-bold">
          ⬇️ ব্যাকআপ ডাউনলোড
        </button>
      </div>

      {/* ═══ ইমপোর্ট ═══ */}
      <div className="card p-4 sm:p-5">
        <h3 className="text-[15px] font-bold" style={{ color: 'var(--v-ink)' }}>ব্যাকআপ থেকে পুনরুদ্ধার</h3>

        <label className="label mt-3" htmlFor="bk-file">ব্যাকআপ ফাইল (.json)</label>
        <input id="bk-file" type="file" accept="application/json,.json" className="input text-[12px]"
          onChange={(e) => { const f = e.target.files?.[0]; if (f) void pick(f); }} />
        {fileName && <p className="mt-1 text-[11px]" style={{ color: 'var(--v-dim)' }}>নির্বাচিত: {fileName}</p>}

        <label className="label mt-2.5" htmlFor="bk-ipass">পাসফ্রেজ (টোকেন থাকলে)</label>
        <input id="bk-ipass" type="password" className="input" value={importPass}
          autoComplete="new-password"
          onChange={(e) => setImportPass(e.target.value)} placeholder="ব্যাকআপ তৈরির সময়কার পাসফ্রেজ" />

        <label className="mt-2.5 flex cursor-pointer items-start gap-2">
          <input type="checkbox" checked={deep} onChange={(e) => setDeep(e.target.checked)}
            className="mt-0.5 h-4 w-4 cursor-pointer" />
          <span className="text-[11.5px]" style={{ color: 'var(--v-mut)' }}>
            গভীর যাচাই — টেলিগ্রামে গিয়ে প্রতিটি বট টোকেন ও Chat ID সত্যিই কাজ করে কি না দেখা
            (পাসফ্রেজ লাগে, একটু সময় নেয়)
          </span>
        </label>

        <button onClick={validate} disabled={busy !== null || !file}
          className="btn-ghost wz-cta mt-3 w-full px-5 py-2.5 text-xs font-bold disabled:opacity-50">
          {busy === 'validate' ? 'যাচাই হচ্ছে…' : '🔍 যাচাই করুন (কিছু বদলাবে না)'}
        </button>

        {/* ── ফলাফল ── */}
        {check && (
          <div className="wz-rise mt-3 space-y-2">
            {errors.length > 0 && (
              <div className="rounded-lg p-3" style={{ background: 'var(--tint-violet)' }}>
                <p className="text-[12px] font-bold" style={{ color: 'var(--v-heat)' }}>✕ ব্যাকআপ ব্যবহারযোগ্য নয়</p>
                <ul className="mt-1 space-y-0.5">
                  {errors.map((i, n) => (
                    <li key={n} className="text-[11.5px]" style={{ color: 'var(--v-heat)' }}>• {i.message}</li>
                  ))}
                </ul>
              </div>
            )}
            {warnings.length > 0 && (
              <div className="rounded-lg p-3" style={{ background: 'var(--tint-ice)' }}>
                <p className="text-[12px] font-bold" style={{ color: 'var(--v-ink)' }}>⚠️ সতর্কতা</p>
                <ul className="mt-1 space-y-0.5">
                  {warnings.map((i, n) => (
                    <li key={n} className="text-[11.5px]" style={{ color: 'var(--v-mut)' }}>• {i.message}</li>
                  ))}
                </ul>
              </div>
            )}

            {check.preview && (
              <div className="rounded-lg p-3" style={{ background: 'var(--v-steel)' }}>
                <p className="text-[12px] font-bold" style={{ color: 'var(--v-ink)' }}>প্রিভিউ — যা আমদানি হবে</p>
                <div className="mt-1.5 grid gap-x-4 gap-y-0.5 text-[11.5px] sm:grid-cols-2" style={{ color: 'var(--v-mut)' }}>
                  <span>সংস্করণ: <b style={{ color: 'var(--v-ink)' }}>{check.preview.version}</b></span>
                  <span>তৈরি: <b style={{ color: 'var(--v-ink)' }}>{check.preview.exportedAt.slice(0, 10)}</b></span>
                  <span>টোকেন: <b style={{ color: check.preview.secretsIncluded ? 'var(--v-volt)' : 'var(--v-dim)' }}>
                    {check.preview.secretsIncluded ? 'সিল করা আছে' : 'নেই'}</b></span>
                  <span>ইভেন্ট: <b style={{ color: 'var(--v-ink)' }}>{check.preview.events.enabled}/{check.preview.events.total} চালু</b></span>
                  <span>টেমপ্লেট: <b style={{ color: 'var(--v-ink)' }}>{check.preview.templates}</b></span>
                  <span>শিডিউলার জব: <b style={{ color: 'var(--v-ink)' }}>{check.preview.jobs}</b></span>
                </div>

                {check.preview.bots.length > 0 && (
                  <div className="mt-2 overflow-x-auto">
                    <table className="tbl w-full text-[11px]">
                      <thead><tr>
                        <th>বট</th><th>ভূমিকা</th>
                        <th>Chat ID</th><th>ইভেন্ট</th><th>টোকেন</th>
                      </tr></thead>
                      <tbody>
                        {check.preview.bots.map((b, n) => (
                          <tr key={n}>
                            <td className="font-semibold">{b.label}</td>
                            <td>{b.role}</td>
                            <td className="font-mono">{b.chatIdMasked}</td>
                            <td>{b.events}</td>
                            <td style={{ color: b.hasToken ? 'var(--v-volt)' : 'var(--v-dim)' }}>
                              {b.hasToken ? '🔒 আছে' : '—'}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            )}

            {check.valid && check.willReplace && (
              <>
                <label className="flex cursor-pointer items-start gap-2 rounded-lg p-2.5"
                  style={{ background: replace ? 'var(--tint-violet)' : 'var(--v-steel)' }}>
                  <input type="checkbox" checked={replace} onChange={(e) => setReplace(e.target.checked)}
                    className="mt-0.5 h-4 w-4 cursor-pointer" />
                  <span className="text-[11.5px]" style={{ color: replace ? 'var(--v-heat)' : 'var(--v-mut)' }}>
                    <b>বিদ্যমান {check.willReplace.bots}টি বট মুছে ফেলে</b> প্রতিস্থাপন করুন।
                    না দিলে নতুনগুলো <b>যোগ</b> হবে, পুরনোগুলো থাকবে।
                  </span>
                </label>

                <button onClick={restore} disabled={busy !== null}
                  className="btn-primary wz-cta w-full px-5 py-2.5 text-xs font-bold disabled:opacity-50"
                  style={replace ? { background: 'var(--v-heat)' } : undefined}>
                  {busy === 'restore' ? 'পুনরুদ্ধার হচ্ছে…'
                    : replace ? '⚠️ প্রতিস্থাপন করে পুনরুদ্ধার করুন' : '✓ নিশ্চিত — পুনরুদ্ধার করুন'}
                </button>
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
