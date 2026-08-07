'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { useToast } from '@/components/Toast';

/**
 * ═══════════════════════════════════════════════════════════
 * ★ হোমপেজ কনফিগ — টগল ও ছোট সেটিং (Option A infra)
 *
 *   রিচ কনটেন্ট (পপআপ/ব্যানার/নোটিশ) Campaign মডেলে; এখানে কেবল
 *   অন/অফ টগল ও ছোট মান, যা বিদ্যমান /api/admin/settings রুটে যায়
 *   (whitelist এ home_* / float_* কী যোগ করা হয়েছে)।
 *
 *   • লাইভ ডেলিভারি ফিড — প্রকৃত সম্পন্ন অর্ডার থেকে (সামাজিক প্রমাণ)
 *   • প্রকৃত পরিসংখ্যান — trustMetrics থেকে
 *   • বিশ্বাস স্ট্রিপ — হিরোর নিচে ছোট প্রতিশ্রুতি-বার
 *   • ভাসমান যোগাযোগ — WhatsApp/Telegram বোতাম
 * ═══════════════════════════════════════════════════════════
 */
export default function HomeConfigForm({ settings }: { settings: Record<string, string> }) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const toast = useToast();
  const [busy, setBusy] = useState(false);

  const [liveOn, setLiveOn] = useState(settings.home_live_activity === '1');
  const [liveCount, setLiveCount] = useState(settings.home_live_activity_count || '8');
  const [statsOn, setStatsOn] = useState(settings.home_trust_stats !== '0'); // default on
  const [stripOn, setStripOn] = useState(settings.home_trust_strip !== '0'); // default on
  const [contactType, setContactType] = useState(settings.float_contact_type || '');
  const [contactValue, setContactValue] = useState(settings.float_contact_value || '');

  async function save() {
    setBusy(true);
    try {
      const res = await fetch('/api/admin/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          home_live_activity: liveOn ? '1' : '0',
          home_live_activity_count: liveCount,
          home_trust_stats: statsOn ? '1' : '0',
          home_trust_strip: stripOn ? '1' : '0',
          float_contact_type: contactType,
          float_contact_value: contactValue.trim(),
        }),
      });
      const d = await res.json();
      if (!res.ok) throw new Error(d.error);
      toast.success('সেটিং সংরক্ষিত হয়েছে');
      startTransition(() => router.refresh());
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'সংরক্ষণ করা যায়নি');
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="card p-5">
      <h2 className="mb-1 text-lg font-bold text-slate-900">হোমপেজ সেকশন কনফিগ</h2>
      <p className="mb-4 text-sm text-slate-500">
        কোন অংশগুলো হোমপেজে দেখাবে তা এখান থেকে চালু/বন্ধ করুন।
      </p>

      <div className="space-y-4">
        <Toggle
          checked={liveOn} onChange={setLiveOn}
          label="লাইভ ডেলিভারি ফিড"
          hint="সাম্প্রতিক সম্পন্ন অর্ডারগুলো দেখায় — প্রকৃত তথ্য, শুধু প্রথম নাম (আংশিক গোপন)।"
        />
        {liveOn && (
          <div className="pl-1">
            <label className="label" htmlFor="hc-count">কতটি অর্ডার দেখাবে</label>
            <input id="hc-count" type="number" min={1} max={20} className="input sm:max-w-[160px]"
              value={liveCount} onChange={(e) => setLiveCount(e.target.value)} aria-label="অর্ডার সংখ্যা" />
          </div>
        )}

        <Toggle checked={statsOn} onChange={setStatsOn}
          label="প্রকৃত পরিসংখ্যান"
          hint="সম্পন্ন অর্ডার, সফলতার হার, গড় রেটিং — যথেষ্ট তথ্য থাকলে তবেই দেখায়।" />

        <Toggle checked={stripOn} onChange={setStripOn}
          label="বিশ্বাস স্ট্রিপ"
          hint="হিরোর নিচে ছোট প্রতিশ্রুতি-বার (মানুষ-যাচাই · ফেরত · লাইভ ট্র্যাকিং)।" />

        <div className="border-t pt-4" style={{ borderColor: 'var(--v-edge)' }}>
          <p className="label mb-2">ভাসমান যোগাযোগ বোতাম</p>
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label className="label" htmlFor="hc-ctype">মাধ্যম</label>
              <select id="hc-ctype" className="input" value={contactType} onChange={(e) => setContactType(e.target.value)}>
                <option value="">বন্ধ</option>
                <option value="whatsapp">WhatsApp</option>
                <option value="telegram">Telegram</option>
              </select>
            </div>
            <div>
              <label className="label" htmlFor="hc-cval">লিংক</label>
              <input id="hc-cval" className="input" value={contactValue} onChange={(e) => setContactValue(e.target.value)}
                placeholder="https://wa.me/8801700000000" aria-label="যোগাযোগ লিংক" />
            </div>
          </div>
        </div>
      </div>

      <button onClick={save} disabled={busy} className="btn-primary mt-5 w-full py-3 sm:w-auto sm:px-8">
        {busy ? 'সংরক্ষণ হচ্ছে...' : 'সংরক্ষণ করুন'}
      </button>
    </section>
  );
}

function Toggle({
  checked, onChange, label, hint,
}: {
  checked: boolean; onChange: (v: boolean) => void; label: string; hint: string;
}) {
  return (
    <label className="flex cursor-pointer items-start gap-3">
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="mt-0.5 h-6 w-6 shrink-0 cursor-pointer"
        style={{ accentColor: 'var(--v-volt)' }}
      />
      <span>
        <span className="block text-sm font-bold text-slate-900">{label}</span>
        <span className="block text-xs text-slate-500">{hint}</span>
      </span>
    </label>
  );
}
