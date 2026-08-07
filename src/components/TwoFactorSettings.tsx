'use client';

import { useEffect, useState } from 'react';
import { useToast } from './Toast';

/**
 * ★ 2FA সেটিংস — প্রোফাইল পেজে। setup → QR স্ক্যান → কোড দিয়ে enable →
 *   recovery কোড দেখানো (একবার)। disable-এ পাসওয়ার্ড ও কোড লাগে।
 *
 *   ⚠️ recovery কোড কেবল enable-এর মুহূর্তে দেখানো হয় — সার্ভার হ্যাশ
 *      রাখে, plaintext আর ফেরত দেয় না। তাই ইউজারকে সংরক্ষণে উৎসাহ দিই।
 */
type Status = { enabled: boolean; recoveryRemaining: number };
type SetupData = { secret: string; uri: string; qrSvg: string };

export default function TwoFactorSettings() {
  const toast = useToast();
  const [status, setStatus] = useState<Status | null>(null);
  const [busy, setBusy] = useState(false);
  const [setup, setSetup] = useState<SetupData | null>(null);
  const [code, setCode] = useState('');
  const [password, setPassword] = useState('');
  const [recoveryCodes, setRecoveryCodes] = useState<string[] | null>(null);
  const [disabling, setDisabling] = useState(false);

  async function loadStatus() {
    try {
      const r = await fetch('/api/account/2fa');
      if (r.ok) setStatus(await r.json());
    } catch { /* নীরব — কার্ড না দেখালেও ক্ষতি নেই */ }
  }
  useEffect(() => { loadStatus(); }, []);

  async function startSetup() {
    setBusy(true);
    try {
      const r = await fetch('/api/account/2fa', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'setup' }),
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data.error || 'সেটআপ শুরু করা যায়নি');
      setSetup(data);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'সমস্যা হয়েছে');
    } finally {
      setBusy(false);
    }
  }

  async function confirmEnable() {
    if (!setup || !/^\d{6}$/.test(code)) {
      toast.error('৬-অঙ্কের কোড দিন');
      return;
    }
    if (!password) { toast.error('পাসওয়ার্ড দিন'); return; }
    setBusy(true);
    try {
      const r = await fetch('/api/account/2fa', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'enable', secret: setup.secret, token: code, password }),
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data.error || 'চালু করা যায়নি');
      setRecoveryCodes(data.recoveryCodes);
      setSetup(null);
      setCode(''); setPassword('');
      toast.success('2FA চালু হয়েছে');
      loadStatus();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'সমস্যা হয়েছে');
    } finally {
      setBusy(false);
    }
  }

  async function confirmDisable() {
    if (!password || !/^\d{6}$/.test(code)) {
      toast.error('পাসওয়ার্ড ও ৬-অঙ্কের কোড দিন');
      return;
    }
    setBusy(true);
    try {
      const r = await fetch('/api/account/2fa', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'disable', token: code, password }),
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data.error || 'বন্ধ করা যায়নি');
      setDisabling(false);
      setCode(''); setPassword('');
      toast.success('2FA বন্ধ হয়েছে');
      loadStatus();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'সমস্যা হয়েছে');
    } finally {
      setBusy(false);
    }
  }

  if (!status) return null;

  return (
    <section className="card p-5 sm:p-6">
      <div className="mb-3 flex items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-bold text-slate-900">দুই-ধাপ যাচাই (2FA)</h2>
          <p className="mt-0.5 text-sm text-slate-500">
            পাসওয়ার্ডের সাথে Authenticator কোড — অ্যাকাউন্ট অনেক বেশি সুরক্ষিত।
          </p>
        </div>
        <span
          className={`shrink-0 rounded-full px-3 py-1 text-xs font-bold ${
            status.enabled ? 'bg-green-100 text-green-700' : 'bg-slate-100 text-slate-500'
          }`}
        >
          {status.enabled ? '🛡️ চালু' : 'বন্ধ'}
        </span>
      </div>

      {/* ── recovery কোড দেখানো (enable-এর পর একবার) ── */}
      {recoveryCodes && (
        <div className="mb-4 rounded-lg border-2 border-amber-300 bg-amber-50 p-4">
          <p className="mb-2 text-sm font-bold text-amber-900">
            ⚠️ এই recovery কোডগুলো এখনই নিরাপদে সংরক্ষণ করুন — আর দেখানো হবে না।
          </p>
          <div className="grid grid-cols-2 gap-2 font-mono text-sm">
            {recoveryCodes.map((c) => (
              <div key={c} className="rounded bg-white px-3 py-1.5 text-center tracking-wider">{c}</div>
            ))}
          </div>
          <button
            onClick={() => {
              navigator.clipboard?.writeText(recoveryCodes.join('\n'));
              toast.success('কপি হয়েছে');
            }}
            className="btn-secondary mt-3 w-full py-2 text-sm"
          >
            📋 সব কপি করুন
          </button>
          <button onClick={() => setRecoveryCodes(null)} className="mt-2 w-full py-2 text-sm font-bold text-amber-800">
            সংরক্ষণ করেছি, বন্ধ করুন
          </button>
        </div>
      )}

      {/* ── চালু করার ধাপ ── */}
      {!status.enabled && !setup && !recoveryCodes && (
        <button onClick={startSetup} disabled={busy} className="btn-primary w-full py-2.5">
          {busy ? 'অপেক্ষা করুন...' : '2FA চালু করুন'}
        </button>
      )}

      {!status.enabled && setup && (
        <div className="space-y-3">
          <p className="text-sm text-slate-600">
            ১. Google Authenticator / Authy অ্যাপে নিচের QR কোডটি স্ক্যান করুন:
          </p>
          <div
            className="mx-auto w-fit rounded-lg border bg-white p-2"
            /* eslint-disable-next-line react/no-danger */
            dangerouslySetInnerHTML={{ __html: setup.qrSvg }}
          />
          <details className="text-xs text-slate-500">
            <summary className="cursor-pointer">স্ক্যান করতে না পারলে — ম্যানুয়াল কী</summary>
            <code className="mt-1 block break-all rounded bg-slate-100 p-2 font-mono">{setup.secret}</code>
          </details>
          <p className="text-sm text-slate-600">২. অ্যাপে দেখানো ৬-অঙ্কের কোড ও আপনার পাসওয়ার্ড দিন:</p>
          <input
            className="input text-center text-lg tracking-[0.3em]"
            inputMode="numeric" placeholder="••••••"
            value={code}
            onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
          />
          <input
            className="input" type="password" placeholder="আপনার পাসওয়ার্ড"
            autoComplete="current-password"
            value={password} onChange={(e) => setPassword(e.target.value)}
          />
          <div className="flex gap-2">
            <button onClick={confirmEnable} disabled={busy} className="btn-primary flex-1 py-2.5">
              {busy ? '...' : 'নিশ্চিত করুন'}
            </button>
            <button onClick={() => { setSetup(null); setCode(''); setPassword(''); }} className="btn-secondary py-2.5 px-4">
              বাতিল
            </button>
          </div>
        </div>
      )}

      {/* ── বন্ধ করার ধাপ ── */}
      {status.enabled && !disabling && (
        <div className="space-y-2">
          <p className="text-sm text-slate-500">
            recovery কোড বাকি: <strong>{status.recoveryRemaining}</strong>
          </p>
          <button onClick={() => setDisabling(true)} className="btn-secondary w-full py-2.5 text-red-600">
            2FA বন্ধ করুন
          </button>
        </div>
      )}

      {status.enabled && disabling && (
        <div className="space-y-3">
          <p className="text-sm text-slate-600">নিশ্চিত করতে পাসওয়ার্ড ও বর্তমান কোড দিন:</p>
          <input
            className="input text-center text-lg tracking-[0.3em]"
            inputMode="numeric" placeholder="••••••"
            value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
          />
          <input
            className="input" type="password" placeholder="আপনার পাসওয়ার্ড"
            autoComplete="current-password"
            value={password} onChange={(e) => setPassword(e.target.value)}
          />
          <div className="flex gap-2">
            <button onClick={confirmDisable} disabled={busy} className="btn-secondary flex-1 py-2.5 text-red-600">
              {busy ? '...' : 'বন্ধ করুন'}
            </button>
            <button onClick={() => { setDisabling(false); setCode(''); setPassword(''); }} className="btn-secondary py-2.5 px-4">
              বাতিল
            </button>
          </div>
        </div>
      )}
    </section>
  );
}
