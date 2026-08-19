'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { useToast } from '@/components/Toast';
import type { ProviderInfo, IntegrationCategory } from '@/lib/integrations/types';
import Switch from '@/components/admin/Switch';

/**
 * ★ Integration Hub — অ্যাডমিন কনফিগ। প্রতিটি ক্যাটাগরির প্রোভাইডার
 *   চালু/বন্ধ ও active নির্বাচন। payment ও storage আলাদা জায়গায়
 *   পরিচালিত (read-only এখানে)। কোনো লাইভ ইন্টিগ্রেশন নেই — শুধু কনফিগ।
 */

const CAT_LABEL: Record<IntegrationCategory, string> = {
  payment: 'পেমেন্ট', fulfillment: 'ফুলফিলমেন্ট', sms: 'SMS', email: 'ইমেইল',
  push: 'পুশ নোটিফিকেশন', webhook: 'ওয়েবহুক', storage: 'স্টোরেজ', ai: 'AI', analytics: 'অ্যানালিটিক্স',
};
const MANAGED = new Set<IntegrationCategory>(['fulfillment', 'email', 'sms', 'push', 'webhook', 'ai', 'analytics']);
const ORDER: IntegrationCategory[] = ['payment', 'fulfillment', 'email', 'sms', 'push', 'webhook', 'storage', 'ai', 'analytics'];

export default function IntegrationsManager({ initial }: { initial: ProviderInfo[] }) {
  const toast = useToast();
  const [items, setItems] = useState<ProviderInfo[]>(initial);
  const [busy, setBusy] = useState(false);

  const grouped = useMemo(() => {
    const g: Partial<Record<IntegrationCategory, ProviderInfo[]>> = {};
    for (const it of items) (g[it.category] ||= []).push(it);
    return g;
  }, [items]);

  function toggle(cat: IntegrationCategory, id: string) {
    setItems((xs) => xs.map((x) => (x.category === cat && x.id === id ? { ...x, enabled: !x.enabled } : x)));
  }
  function setActive(cat: IntegrationCategory, id: string) {
    setItems((xs) => xs.map((x) => (x.category === cat ? { ...x, active: x.id === id } : x)));
  }

  async function save() {
    setBusy(true);
    try {
      const body: Record<string, string> = {};
      for (const cat of MANAGED) {
        const list = grouped[cat] || [];
        for (const p of list) body[`integration_${cat}_${p.id}_enabled`] = p.enabled ? '1' : '0';
        const active = list.find((p) => p.active);
        if (active) body[`integration_${cat}_active`] = active.id;
      }
      const res = await fetch('/api/admin/settings', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
      });
      const d = await res.json();
      if (!res.ok) throw new Error(d.error || 'সেভ ব্যর্থ');
      toast.success('ইন্টিগ্রেশন কনফিগ সেভ হয়েছে');
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'সেভ ব্যর্থ');
    } finally { setBusy(false); }
  }

  return (
    <div className="space-y-4">
      <div className="alert-warn text-[13px]">
        <b>কোনো লাইভ ইন্টিগ্রেশন সক্রিয় নয়।</b> ম্যানুয়াল ফুলফিলমেন্ট ও (কনফিগার থাকলে) Resend ইমেইল
        ছাড়া সব প্রোভাইডার কাঠামোগত স্টাব — SDK ও API-কী যোগ করলে সক্রিয় হবে। চালু করলেও কনফিগার্ড না
        হওয়া পর্যন্ত ব্যবসায়িক যুক্তি নিরাপদ fallback ব্যবহার করে।
      </div>

      {ORDER.map((cat) => {
        const list = grouped[cat] || [];
        if (list.length === 0) return null;
        const managed = MANAGED.has(cat);
        return (
          <div key={cat} className="card p-5">
            <div className="mb-3 flex items-center justify-between">
              <h2 className="text-lg font-bold" style={{ color: 'var(--v-ink)' }}>{CAT_LABEL[cat]}</h2>
              {!managed && (
                <span className="text-[11px]" style={{ color: 'var(--v-dim)' }}>
                  {/* ★ ১৮px উঁচু ছিল — পেমেন্ট কনফিগে যাওয়ার একমাত্র লিংক */}
                  {cat === 'payment' ? <Link href="/admin/payments" className="inline-flex min-h-[40px] items-center font-semibold" style={{ color: 'var(--v-ice)' }}>/admin/payments-এ পরিচালিত →</Link> : 'STORAGE_DRIVER env দিয়ে সেট'}
                </span>
              )}
            </div>
            <div className="space-y-2">
              {list.map((p) => (
                <div key={p.id} className="flex flex-wrap items-center justify-between gap-3 rounded-lg border p-3"
                  style={{ borderColor: 'var(--v-edge)', background: 'var(--v-fill)' }}>
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-sm font-bold" style={{ color: 'var(--v-ink)' }}>{p.label}</span>
                      <span className="badge" style={{ background: p.kind === 'MANUAL' || p.kind === 'BUILTIN' ? 'var(--tint-volt)' : 'var(--tint-ice)', color: p.kind === 'MANUAL' || p.kind === 'BUILTIN' ? 'var(--v-volt)' : 'var(--v-ice)' }}>{p.kind}</span>
                      <span className="badge" style={{ background: p.configured ? 'var(--tint-volt)' : 'var(--v-fill2)', color: p.configured ? 'var(--v-volt)' : 'var(--v-dim)' }}>{p.configured ? 'কনফিগার্ড' : 'কী নেই'}</span>
                      {p.active && <span className="badge" style={{ background: 'var(--tint-violet)', color: 'var(--violet)' }}>ACTIVE</span>}
                    </div>
                    {p.note && <p className="mt-0.5 text-[11px]" style={{ color: 'var(--v-dim)' }}>{p.note}</p>}
                  </div>
                  {managed ? (
                    <div className="flex items-center gap-2">
                      <button type="button" onClick={() => setActive(cat, p.id)} disabled={!p.enabled}
                        className="v-chip text-[11px]" aria-pressed={p.active}
                        style={p.active ? { borderColor: 'var(--violet)', color: 'var(--violet)', background: 'var(--tint-violet)' } : undefined}>
                        {p.active ? 'Active' : 'Active করুন'}
                      </button>
                      <Switch
                        on={p.enabled}
                        label={`${p.label} চালু/বন্ধ`}
                        onClick={() => toggle(cat, p.id)}
                      />
                    </div>
                  ) : (
                    <span className="badge" style={{ background: p.active || p.enabled ? 'var(--tint-volt)' : 'var(--v-fill2)', color: p.active || p.enabled ? 'var(--v-volt)' : 'var(--v-dim)' }}>
                      {p.active ? 'সক্রিয়' : p.enabled ? 'চালু' : 'বন্ধ'}
                    </span>
                  )}
                </div>
              ))}
            </div>
          </div>
        );
      })}

      <button onClick={save} disabled={busy} className="btn-primary">
        {busy ? 'সেভ হচ্ছে…' : 'ইন্টিগ্রেশন কনফিগ সংরক্ষণ করুন'}
      </button>
    </div>
  );
}
