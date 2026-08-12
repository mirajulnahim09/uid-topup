'use client';

import { useState } from 'react';
import { useToast } from '@/components/Toast';

/**
 * ═══════════════════════════════════════════════════════════
 * ★★★ Group I (৩) — OTP চ্যানেল কনফিগ (Group E গেটওয়ে-প্যাটার্ন)
 *
 *   ⚠️ ক্রেডেনশিয়ালের **মান কখনো** সার্ভার থেকে আসে না — কেবল
 *   "সেট আছে কি না"। সেট থাকলে ঘরে `••••••` দেখায়, আর সেটি অপরিবর্তিত
 *   রেখে সেভ করলে সার্ভার সেটিকে "বদলায়নি" ধরে নেয়।
 * ═══════════════════════════════════════════════════════════
 */

type ProviderMeta = {
  id: string;
  label: string;
  implemented: boolean;
  fields: { key: string; label: string; secret: boolean }[];
  note?: string;
};

export type OtpSnapshot = {
  config: {
    emailEnabled: boolean;
    smsEnabled: boolean;
    signupChannel: 'email' | 'sms' | 'either' | 'both';
    requireAtSignup: boolean;
    requireAtDeposit: boolean;
    requireAtOrder: boolean;
    smsProvider: string;
  };
  channels: {
    email: { enabled: boolean; configured: boolean };
    sms: {
      enabled: boolean;
      provider: string;
      implemented: boolean;
      keysSet: { key: string; set: boolean }[];
    };
  };
  providers: ProviderMeta[];
};

const MASK = '••••••';

export default function OtpSettings({ initial }: { initial: OtpSnapshot }) {
  const toast = useToast();
  const [snap, setSnap] = useState(initial);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testTo, setTestTo] = useState('');
  const [creds, setCreds] = useState<Record<string, string>>({});

  const cfg = snap.config;
  const meta = snap.providers.find((p) => p.id === cfg.smsProvider);

  async function save(patch: Record<string, unknown>) {
    setSaving(true);
    try {
      const res = await fetch('/api/admin/otp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(patch),
      });
      const d = await res.json();
      if (!res.ok) throw new Error(d.error);
      setSnap(d);
      setCreds({});
      toast.success('সেভ হয়েছে');
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'সেভ করা যায়নি');
    } finally {
      setSaving(false);
    }
  }

  async function testConnection() {
    setTesting(true);
    try {
      const res = await fetch('/api/admin/otp', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ to: testTo }),
      });
      const d = await res.json();
      if (!res.ok) throw new Error(d.error);
      if (d.status === 'SENT') toast.success('পাঠানো হয়েছে');
      else toast.error(d.reason || `ফল: ${d.status}`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'পরীক্ষা করা যায়নি');
    } finally {
      setTesting(false);
    }
  }

  const Toggle = ({
    label, hint, value, onChange, danger,
  }: {
    label: string; hint?: string; value: boolean;
    onChange: (v: boolean) => void; danger?: boolean;
  }) => (
    <label className="flex items-start justify-between gap-4 py-3">
      <span className="min-w-0">
        <span className="block text-sm font-semibold">{label}</span>
        {hint && (
          <span className="mt-0.5 block text-xs" style={{ color: danger ? 'var(--sem-warning, var(--v-mut))' : 'var(--v-mut)' }}>
            {hint}
          </span>
        )}
      </span>
      <input
        type="checkbox"
        checked={value}
        disabled={saving}
        onChange={(e) => onChange(e.target.checked)}
        className="mt-0.5 shrink-0"
      />
    </label>
  );

  return (
    <section className="card p-5 sm:p-6">
      <h2 className="dsp text-base font-semibold">যাচাই কোড (OTP)</h2>
      <p className="mt-1 text-xs" style={{ color: 'var(--v-mut)' }}>
        একই কোড-ব্যবস্থা, দুটি মাধ্যম। কেবল পৌঁছানোর পথ আলাদা।
      </p>

      {/* ── চ্যানেল ── */}
      <div className="mt-5 divide-y" style={{ borderColor: 'var(--v-edge)' }}>
        <Toggle
          label="ইমেইল চ্যানেল"
          hint={
            snap.channels.email.configured
              ? 'Resend কনফিগার করা আছে'
              : '⚠️ RESEND_API_KEY নেই — চালু থাকলেও কোড যাবে না'
          }
          value={cfg.emailEnabled}
          onChange={(v) => save({ emailEnabled: v })}
        />
        <Toggle
          label="SMS চ্যানেল"
          hint={
            meta && !meta.implemented
              ? `⚠️ ${meta.label} বাস্তবায়িত নয় — গেটওয়ের ডকুমেন্ট দরকার`
              : 'গেটওয়ে বেছে নিয়ে ক্রেডেনশিয়াল দিন'
          }
          value={cfg.smsEnabled}
          onChange={(v) => save({ smsEnabled: v })}
        />
      </div>

      {/* ── সাইনআপে কোন মাধ্যম ── */}
      <div className="mt-5">
        <label htmlFor="sc" className="label">সাইনআপে কোন মাধ্যম</label>
        <select
          id="sc"
          className="input mt-1"
          value={cfg.signupChannel}
          disabled={saving}
          onChange={(e) => save({ signupChannel: e.target.value })}
        >
          <option value="email">শুধু ইমেইল</option>
          <option value="sms">শুধু SMS</option>
          <option value="either">যেটি পাওয়া যায়</option>
          <option value="both">দুটোতেই</option>
        </select>
      </div>

      {/* ── কোথায় বাধ্যতামূলক ── */}
      <div className="mt-6">
        <h3 className="text-sm font-bold">কোথায় বাধ্যতামূলক</h3>
        <div className="mt-1 divide-y" style={{ borderColor: 'var(--v-edge)' }}>
          <Toggle
            label="রেজিস্ট্রেশনে"
            hint="বন্ধ করলে নতুন অ্যাকাউন্ট যাচাই ছাড়াই তৈরি হবে"
            value={cfg.requireAtSignup}
            onChange={(v) => save({ requireAtSignup: v })}
            danger
          />
          <Toggle
            label="ডিপোজিটে"
            hint="⚠️ টাকার পথ — চালু করার আগে ভেবে নিন"
            value={cfg.requireAtDeposit}
            onChange={(v) => save({ requireAtDeposit: v })}
            danger
          />
          <Toggle
            label="অর্ডারে"
            hint="⚠️ টাকার পথ — চালু করলে প্রতিটি অর্ডারে কোড লাগবে"
            value={cfg.requireAtOrder}
            onChange={(v) => save({ requireAtOrder: v })}
            danger
          />
        </div>
      </div>

      {/* ── SMS গেটওয়ে ── */}
      <div className="mt-6 border-t pt-5" style={{ borderColor: 'var(--v-edge)' }}>
        <h3 className="text-sm font-bold">SMS গেটওয়ে</h3>

        <label htmlFor="sp" className="label mt-3">প্রোভাইডার</label>
        <select
          id="sp"
          className="input mt-1"
          value={cfg.smsProvider}
          disabled={saving}
          onChange={(e) => save({ smsProvider: e.target.value })}
        >
          <option value="">— বেছে নিন —</option>
          {snap.providers.map((p) => (
            <option key={p.id} value={p.id}>
              {p.label}
              {p.implemented ? '' : ' (বাস্তবায়িত নয়)'}
            </option>
          ))}
        </select>

        {meta?.note && (
          <p className="mt-2 text-xs" style={{ color: 'var(--v-mut)' }}>{meta.note}</p>
        )}

        {meta && meta.fields.length > 0 && (
          <div className="mt-4 space-y-3">
            {meta.fields.map((f) => {
              const isSet = snap.channels.sms.keysSet.find((k) => k.key === f.key)?.set;
              return (
                <div key={f.key}>
                  <label htmlFor={`c-${f.key}`} className="label">{f.label}</label>
                  <input
                    id={`c-${f.key}`}
                    className="input mt-1 font-mono text-sm"
                    type={f.secret ? 'password' : 'text'}
                    autoComplete="off"
                    placeholder={isSet ? MASK : ''}
                    value={creds[f.key] ?? ''}
                    onChange={(e) => setCreds({ ...creds, [f.key]: e.target.value })}
                  />
                  {isSet && !creds[f.key] && (
                    <p className="mt-1 text-xs" style={{ color: 'var(--v-mut)' }}>
                      সেট করা আছে — খালি রাখলে অপরিবর্তিত থাকবে
                    </p>
                  )}
                </div>
              );
            })}
            <button
              type="button"
              className="btn-ghost px-4 text-sm"
              disabled={saving || Object.keys(creds).length === 0}
              onClick={() => save({ credentials: creds })}
            >
              ক্রেডেনশিয়াল সেভ
            </button>
          </div>
        )}

        {/* ── Test connection ── */}
        <div className="mt-5 border-t pt-4" style={{ borderColor: 'var(--v-edge)' }}>
          <label htmlFor="tt" className="label">সংযোগ পরীক্ষা — কোন নাম্বারে</label>
          <div className="mt-1 flex flex-wrap gap-2">
            <input
              id="tt"
              className="input max-w-[220px]"
              inputMode="numeric"
              placeholder="01712345678"
              value={testTo}
              onChange={(e) => setTestTo(e.target.value)}
            />
            <button
              type="button"
              className="btn-ghost px-4 text-sm"
              disabled={testing || !testTo}
              onClick={testConnection}
            >
              {testing ? 'পাঠানো হচ্ছে…' : 'Test connection'}
            </button>
          </div>
          <p className="mt-1.5 text-xs" style={{ color: 'var(--v-mut)' }}>
            ⚠️ আসল SMS যায় (log প্রোভাইডার হলে কেবল সার্ভার লগে)।
          </p>
        </div>
      </div>
    </section>
  );
}
