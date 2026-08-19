'use client';

import { useEffect, useState, useCallback } from 'react';
import { useToast } from '../Toast';

/**
 * ★ Release Readiness + Feature Flags প্যানেল (অ্যাডমিন টুলস)।
 *   `/api/admin/readiness` (env + health + payments + flags) দেখায়,
 *   flag টগল সাধারণ settings রুট দিয়ে সেভ করে (flag_<key>)।
 */
type Flag = { key: string; label: string; enabled: boolean; isDefault: boolean };
type Subsystem = { label: string; state: string; critical: boolean; detail?: string };
type Payment = { id: string; label: string; enabled: boolean; configured: boolean; health: { message: string; ok: boolean } };
type Readiness = {
  ready: boolean;
  blockers: string[];
  warnings: string[];
  health: { subsystems: Subsystem[] };
  payments: Payment[];
  flags: Flag[];
};

export default function ReadinessPanel() {
  const toast = useToast();
  const [data, setData] = useState<Readiness | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await fetch('/api/admin/readiness');
      if (r.ok) setData(await r.json());
    } catch { /* নীরব */ }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { load(); }, [load]);

  async function toggleFlag(key: string, next: boolean) {
    setSaving(key);
    try {
      const r = await fetch('/api/admin/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ [`flag_${key}`]: next ? '1' : '0' }),
      });
      if (!r.ok) {
        const d = await r.json().catch(() => ({}));
        throw new Error(d.error || 'সেভ হয়নি');
      }
      toast.success('আপডেট হয়েছে');
      setData((prev) =>
        prev ? { ...prev, flags: prev.flags.map((f) => (f.key === key ? { ...f, enabled: next, isDefault: false } : f)) } : prev
      );
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'সমস্যা হয়েছে');
    } finally {
      setSaving(null);
    }
  }

  if (loading) return <div className="card p-5 text-sm text-slate-500">লোড হচ্ছে…</div>;
  if (!data) return null;

  return (
    <div className="card p-5">
      <div className="flex items-center justify-between">
        <h2 className="font-bold text-slate-900">সিস্টেম প্রস্তুতি</h2>
        <button onClick={load} className="btn-ghost text-sm">🔄 রিফ্রেশ</button>
      </div>

      {/* সার্বিক অবস্থা */}
      <div className={`mt-3 rounded-lg p-3 text-sm font-bold ${data.ready ? 'bg-green-50 text-green-700' : 'bg-red-50 text-red-700'}`}>
        {data.ready ? '✅ সব ঠিক আছে — deploy-ready' : '⚠️ কিছু সমস্যা আছে'}
      </div>

      {data.blockers.length > 0 && (
        <ul className="mt-2 space-y-1 text-sm text-red-600">
          {data.blockers.map((b, i) => <li key={i}>✗ {b}</li>)}
        </ul>
      )}
      {data.warnings.length > 0 && (
        <ul className="mt-2 space-y-1 text-xs text-amber-600">
          {data.warnings.map((w, i) => <li key={i}>• {w}</li>)}
        </ul>
      )}

      {/* সাবসিস্টেম হেলথ */}
      <h3 className="mt-4 text-xs font-bold uppercase tracking-wide text-slate-500">সাবসিস্টেম</h3>
      <div className="mt-1 grid gap-1 sm:grid-cols-2">
        {data.health.subsystems.map((s) => (
          <div key={s.label} className="flex items-center justify-between rounded bg-slate-50 px-3 py-1.5 text-sm">
            <span className="text-slate-600">{s.label}</span>
            <span className={
              s.state === 'up' || s.state === 'ready' ? 'text-green-600'
                : s.state === 'down' ? 'text-red-600' : 'text-slate-400'
            }>{s.state}</span>
          </div>
        ))}
      </div>

      {/* Feature Flags */}
      <h3 className="mt-4 text-xs font-bold uppercase tracking-wide text-slate-500">ফিচার ফ্ল্যাগ</h3>
      <div className="mt-1 space-y-1">
        {data.flags.map((f) => (
          <div key={f.key} className="flex items-center justify-between rounded bg-slate-50 px-3 py-2 text-sm">
            <span className="text-slate-700">{f.label}</span>
            <button
              onClick={() => toggleFlag(f.key, !f.enabled)}
              disabled={saving === f.key}
              /* ★ ২৪×৪৩ ছিল (অডিটে ৫৫ হিট) — এটি একটি **ফিচার ফ্ল্যাগ
                 টগল**, অর্থাৎ চাপলে সাইটের আচরণ বদলায়। ছোট লক্ষ্যে ভুল
                 ট্যাপের দাম এখানে বেশি। মাপ বাড়ল, চেহারা নয়। */
              className={`inline-flex min-h-[40px] min-w-[56px] items-center justify-center rounded-full px-3 text-xs font-bold transition ${
                f.enabled ? 'bg-green-100 text-green-700' : 'bg-slate-200 text-slate-500'
              }`}
            >
              {saving === f.key ? '…' : f.enabled ? 'চালু' : 'বন্ধ'}
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}
