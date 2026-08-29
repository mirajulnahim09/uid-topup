'use client';

import { useState } from 'react';
import { useToast } from '@/components/Toast';
import type { ProviderInfo, ProviderHealth, ProviderMode } from '@/lib/payments/types';
import Switch from '@/components/admin/Switch';

/**
 * ★ পেমেন্ট প্রোভাইডার ক্রেডেনশিয়াল ব্যবস্থাপনা (অ্যাডমিন)।
 *
 *   প্রতিটি গেটওয়ের জন্য: API-কী/সিক্রেট বসানো, টেস্ট/লাইভ মোড, চালু/বন্ধ,
 *   সংযোগ যাচাই (health), সেভ। "কী বসান → চালু করুন → সেভ → সক্রিয়" —
 *   কোনো কোড/ডিপ্লয় বদল ছাড়াই।
 *
 *   ⚠️ সিক্রেট মান কখনো সার্ভার থেকে ফেরত আসে না — সেট করা ফিল্ডে শুধু
 *   `••••` দেখায়; নতুন মান টাইপ করলেই কেবল সেটি বদলায়।
 *   ⚠️ লাইভ প্রসেসিং এখনো স্টাব — কী সম্পূর্ণ হলেও health = "কনফিগার্ড
 *   (ড্রাইভার বাকি)"। তাই ভুল কনফিগে টাকা নড়ে না।
 */

const HEALTH_STYLE: Record<ProviderHealth['status'], { bg: string; fg: string; dot: string }> = {
  MANUAL_READY:       { bg: 'var(--tint-volt)', fg: 'var(--v-volt)', dot: '#22c55e' },
  CONFIGURED_PENDING: { bg: 'var(--tint-ice)',  fg: 'var(--v-ice)',  dot: '#38bdf8' },
  // ★ আগে `bg` ছিল হার্ডকোড sand-gold আর `fg` এর ফলব্যাক `#e6c584` —
  //   অথচ `--v-heat` দুই থিমেই সংজ্ঞায়িত, তাই ফলব্যাকটি কখনো ব্যবহৃতই
  //   হতো না (মৃত)। বাকি তিনটি সারির মতোই এখন `--tint-*` + `--v-*` জোড়া।
  PARTIAL_KEYS:       { bg: 'var(--tint-heat)', fg: 'var(--v-heat)', dot: '#e0a83a' },
  NO_KEYS:            { bg: 'var(--v-fill2)', fg: 'var(--v-mut)', dot: '#94a3b8' },
};

const MASK = '••••••••';

type Row = ProviderInfo & { draft: Record<string, string>; open: boolean; health: ProviderHealth };

export default function PaymentProviders({ initialProviders }: { initialProviders: ProviderInfo[] }) {
  const toast = useToast();
  const [rows, setRows] = useState<Row[]>(
    initialProviders.map((p) => ({ ...p, draft: {}, open: false }))
  );
  const [busy, setBusy] = useState<string | null>(null);

  const gateways = rows.filter((p) => p.kind === 'GATEWAY');
  const manual = rows.find((p) => p.kind === 'MANUAL');

  function patch(id: string, fn: (r: Row) => Row) {
    setRows((xs) => xs.map((x) => (x.id === id ? fn(x) : x)));
  }

  async function save(row: Row) {
    setBusy(row.id);
    try {
      const res = await fetch('/api/admin/payment/provider', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: row.id, keys: row.draft, mode: row.mode, enabled: row.enabled }),
      });
      const d = await res.json();
      if (!res.ok) throw new Error(d.error || 'সেভ ব্যর্থ');
      // সার্ভার থেকে masked তালিকা — draft ক্লিয়ার
      const fresh: ProviderInfo[] = d.providers;
      setRows((xs) =>
        xs.map((x) => {
          const f = fresh.find((y) => y.id === x.id);
          return f ? { ...f, draft: {}, open: x.open, health: f.health } : x;
        })
      );
      toast.success(`${row.label} — কনফিগ সেভ হয়েছে`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'সেভ ব্যর্থ');
    } finally {
      setBusy(null);
    }
  }

  async function testConn(row: Row) {
    setBusy(row.id + ':test');
    try {
      const res = await fetch('/api/admin/payment/provider', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: row.id }),
      });
      const d = await res.json();
      if (!res.ok) throw new Error(d.error || 'যাচাই ব্যর্থ');
      patch(row.id, (r) => ({ ...r, health: d.health }));
      const h: ProviderHealth = d.health;
      if (h.ok || h.status === 'CONFIGURED_PENDING') toast.success(h.message);
      else toast.info(h.message);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'যাচাই ব্যর্থ');
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="card p-5">
      <h2 className="text-lg font-bold" style={{ color: 'var(--v-ink)' }}>পেমেন্ট প্রোভাইডার ও ক্রেডেনশিয়াল</h2>
      <p className="mb-4 mt-1 text-[12.5px] leading-relaxed" style={{ color: 'var(--v-mut)' }}>
        API-কী/সিক্রেট বসিয়ে টেস্ট বা লাইভ মোডে চালু করুন। কী সংরক্ষিত থাকে নিরাপদে (মান কখনো
        ফেরত দেখানো হয় না)। লাইভ পেমেন্ট প্রসেসিং এখনো বাস্তবায়ন-অপেক্ষায় — তাই কনফিগ সম্পূর্ণ
        হলেও এখন ম্যানুয়ালই চলবে, ভুল কনফিগে টাকা নড়বে না।
      </p>

      {/* ম্যানুয়াল — সবসময় প্রস্তুত */}
      {manual && (
        <div className="mb-2 flex flex-wrap items-center justify-between gap-3 rounded-lg border p-3"
          style={{ borderColor: 'var(--v-edge)', background: 'var(--v-fill)' }}>
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm font-bold" style={{ color: 'var(--v-ink)' }}>{manual.label}</span>
            <HealthBadge health={manual.health} />
          </div>
          <span className="text-[11.5px]" style={{ color: 'var(--v-dim)' }}>ভিত্তি প্রোভাইডার — সবসময় সক্রিয়</span>
        </div>
      )}

      <div className="space-y-2.5">
        {gateways.map((p) => {
          const style = HEALTH_STYLE[p.health.status];
          return (
            <div key={p.id} className="rounded-lg border" style={{ borderColor: 'var(--v-edge)', background: 'var(--v-fill)' }}>
              {/* সারি হেডার */}
              <div className="flex flex-wrap items-center justify-between gap-3 p-3">
                {/* ★ ২৫px উঁচু ছিল — অথচ এটিই গেটওয়ের কনফিগ খোলার
                    একমাত্র পথ (৭টি প্রোভাইডারে ৭ বার)। */}
                <button
                  type="button"
                  onClick={() => patch(p.id, (r) => ({ ...r, open: !r.open }))}
                  className="flex min-h-[40px] min-w-0 flex-1 items-center gap-2 text-left"
                  aria-expanded={p.open}
                >
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"
                    className="shrink-0 transition-transform" style={{ color: 'var(--v-mut)', transform: p.open ? 'rotate(90deg)' : 'none' }}>
                    <path d="M9 6l6 6-6 6" />
                  </svg>
                  <span className="text-sm font-bold" style={{ color: 'var(--v-ink)' }}>{p.label}</span>
                  <HealthBadge health={p.health} />
                  <span className="badge" style={{ background: p.mode === 'live' ? 'rgba(34,197,94,.14)' : 'var(--v-fill2)', color: p.mode === 'live' ? '#22c55e' : 'var(--v-dim)' }}>
                    {p.mode === 'live' ? 'লাইভ' : 'টেস্ট'}
                  </span>
                </button>

                {/* enable switch — শেয়ার্ড কম্পোনেন্ট (৪০px ট্যাপ-লক্ষ্য) */}
                <Switch
                  on={p.enabled}
                  label={`${p.label} চালু/বন্ধ`}
                  onClick={() => patch(p.id, (r) => ({ ...r, enabled: !r.enabled }))}
                />
              </div>

              {/* ক্রেডেনশিয়াল ফর্ম */}
              {p.open && (
                <div className="border-t px-3 pb-3.5 pt-3" style={{ borderColor: 'var(--v-edge)' }}>
                  {/* মোড */}
                  <div className="mb-3 flex items-center gap-2">
                    <span className="text-[12px] font-semibold" style={{ color: 'var(--v-mut)' }}>পরিবেশ:</span>
                    <div className="inline-flex rounded-lg border p-0.5" style={{ borderColor: 'var(--v-edge2)' }} role="group" aria-label="পরিবেশ">
                      {(['test', 'live'] as ProviderMode[]).map((m) => (
                        /* ★ টেস্ট/লাইভ — টাকার পথ বদলায়, তাই ভুল ট্যাপের
                           দাম সবচেয়ে বেশি এখানেই। ৩৪px → ৪০px। */
                        <button key={m} type="button" onClick={() => patch(p.id, (r) => ({ ...r, mode: m }))}
                          aria-pressed={p.mode === m}
                          className="inline-flex min-h-[40px] items-center rounded-md px-3 text-[12px] font-bold transition"
                          style={p.mode === m ? { background: 'var(--violet)', color: '#fff' } : { color: 'var(--v-mut)' }}>
                          {m === 'test' ? 'টেস্ট' : 'লাইভ'}
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* কী ফিল্ড */}
                  <div className="grid gap-3 sm:grid-cols-2">
                    {p.keyFields.map((field) => {
                      const fromEnv = p.envKeys.includes(field);
                      const isSet = p.keysSet[field];
                      const isSecret = /secret|password|passwd|private|key/i.test(field);
                      return (
                        <div key={field}>
                          <label className="label flex items-center gap-1.5" htmlFor={`pp-${p.id}-${field}`}>
                            <span className="font-mono text-[11px]">{field}</span>
                            {fromEnv && <span className="badge" style={{ background: 'var(--v-fill2)', color: 'var(--v-dim)' }}>env</span>}
                          </label>
                          <input
                            id={`pp-${p.id}-${field}`}
                            className="input font-mono text-[12px]"
                            type={isSecret ? 'password' : 'text'}
                            autoComplete="off"
                            disabled={fromEnv}
                            value={p.draft[field] ?? ''}
                            placeholder={fromEnv ? 'env থেকে (এখানে বদলানো যাবে না)' : isSet ? MASK : 'কী বসান'}
                            onChange={(e) => patch(p.id, (r) => ({ ...r, draft: { ...r.draft, [field]: e.target.value } }))}
                          />
                        </div>
                      );
                    })}
                  </div>

                  <p className="mt-2 text-[11px]" style={{ color: 'var(--v-dim)' }}>
                    {p.health.message}
                  </p>

                  <div className="mt-3 flex flex-wrap items-center gap-2">
                    <button onClick={() => save(p)} disabled={busy === p.id} className="btn-primary px-4 py-1.5 text-[13px]">
                      {busy === p.id ? 'সেভ হচ্ছে…' : 'সেভ করুন'}
                    </button>
                    <button onClick={() => testConn(p)} disabled={busy === p.id + ':test'} className="btn-ghost px-4 py-1.5 text-[13px]">
                      {busy === p.id + ':test' ? 'যাচাই হচ্ছে…' : 'সংযোগ যাচাই'}
                    </button>
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function HealthBadge({ health }: { health: ProviderHealth }) {
  const s = HEALTH_STYLE[health.status];
  const label =
    health.status === 'MANUAL_READY' ? 'প্রস্তুত'
      : health.status === 'CONFIGURED_PENDING' ? 'কনফিগার্ড'
        : health.status === 'PARTIAL_KEYS' ? 'আংশিক'
          : 'কী নেই';
  return (
    <span className="badge inline-flex items-center gap-1.5" style={{ background: s.bg, color: s.fg }}>
      <span className="h-1.5 w-1.5 rounded-full" style={{ background: s.dot }} />
      {label}
    </span>
  );
}
