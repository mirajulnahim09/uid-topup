'use client';

import { useState } from 'react';
import { useToast } from '@/components/Toast';
import type { ProviderInfo } from '@/lib/payments/types';

/**
 * ★ ফুলফিলমেন্ট ও পেমেন্ট-প্রোভাইডার কনফিগ (অ্যাডমিন)।
 *   মোড ও প্রোভাইডার টগল সেটিংসে সেভ হয়; নীতি-স্তর (policy.ts) ও
 *   registry এগুলো পড়ে। gateway configured না থাকলে automatic দিলেও
 *   আচরণ নিরাপদে manual-ই থাকে — তাই ভুল কনফিগে টাকা নড়ে না।
 */

type Modes = { pay_mode: string; deposit_approval: string; order_approval: string; refund_mode: string };

const SEGMENTS: { key: keyof Modes; label: string; opts: { v: string; t: string }[]; note: string }[] = [
  { key: 'pay_mode', label: 'পেমেন্ট মোড', note: 'সামগ্রিকভাবে পেমেন্ট কীভাবে নেওয়া হবে।', opts: [{ v: 'manual', t: 'ম্যানুয়াল' }, { v: 'automatic', t: 'অটোমেটিক' }, { v: 'hybrid', t: 'হাইব্রিড' }] },
  { key: 'deposit_approval', label: 'ডিপোজিট অনুমোদন', note: 'টাকা যোগের রিকোয়েস্ট কে অনুমোদন করবে।', opts: [{ v: 'manual', t: 'ম্যানুয়াল' }, { v: 'automatic', t: 'অটোমেটিক' }] },
  { key: 'order_approval', label: 'অর্ডার অনুমোদন', note: 'অর্ডার ডেলিভারি/সম্পন্ন করার ধরন।', opts: [{ v: 'manual', t: 'ম্যানুয়াল' }, { v: 'automatic', t: 'অটোমেটিক' }] },
  { key: 'refund_mode', label: 'রিফান্ড', note: 'টাকা ফেরত হাতে না প্রোগ্রাম্যাটিক।', opts: [{ v: 'manual', t: 'ম্যানুয়াল' }, { v: 'automatic', t: 'অটোমেটিক' }] },
];

export default function FulfillmentSettings({
  initialModes, initialProviders,
}: {
  initialModes: Modes;
  initialProviders: ProviderInfo[];
}) {
  const toast = useToast();
  const [modes, setModes] = useState<Modes>(initialModes);
  // ★ প্রোভাইডার তালিকা শুধু "auto বাছা হয়েছে কিন্তু গেটওয়ে নেই" সতর্কতার
  //   জন্য পড়া হয় — চালু/বন্ধ ও ক্রেডেনশিয়াল PaymentProviders কার্ডে।
  const providers = initialProviders;
  const [busy, setBusy] = useState(false);

  async function save() {
    setBusy(true);
    try {
      // ★ শুধু ফুলফিলমেন্ট মোড এখানে সেভ হয়। প্রোভাইডার চালু/বন্ধ ও
      //   ক্রেডেনশিয়াল আলাদা কার্ডে (PaymentProviders) — একটি concern
      //   একটিই জায়গায় (DRY, কনফ্লিক্ট নয়)।
      const res = await fetch('/api/admin/settings', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...modes }),
      });
      const d = await res.json();
      if (!res.ok) throw new Error(d.error || 'সেভ ব্যর্থ');
      toast.success('ফুলফিলমেন্ট মোড সেভ হয়েছে');
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'সেভ ব্যর্থ');
    } finally { setBusy(false); }
  }

  const autoSelected = Object.values(modes).some((m) => m !== 'manual');
  const anyAutoProvider = providers.some((p) => p.enabled && p.configured && (p.capabilities.autoVerify || p.capabilities.autoRefund));

  return (
    <div className="space-y-5">
      {/* নিরাপত্তা-নোট */}
      <div className="alert-warn text-[13px]">
        <b>বর্তমানে সম্পূর্ণ ম্যানুয়াল।</b> কোনো অটোমেটিক গেটওয়ে কনফিগার করা না থাকা পর্যন্ত
        উপরে <b>অটোমেটিক</b> বাছলেও আচরণ নিরাপদে <b>ম্যানুয়াল</b>-ই থাকবে — তাই ভুল কনফিগে টাকা নড়বে না।
      </div>

      {/* মোড সেগমেন্ট */}
      <div className="card p-5">
        <h2 className="mb-4 text-lg font-bold" style={{ color: 'var(--v-ink)' }}>ফুলফিলমেন্ট মোড</h2>
        <div className="grid gap-4 sm:grid-cols-2">
          {SEGMENTS.map((seg) => (
            <div key={seg.key}>
              <p className="mb-1.5 text-sm font-semibold" style={{ color: 'var(--v-ink)' }}>{seg.label}</p>
              <div className="inline-flex rounded-lg border p-0.5" style={{ borderColor: 'var(--v-edge2)', background: 'var(--v-fill)' }} role="group" aria-label={seg.label}>
                {seg.opts.map((o) => {
                  const active = modes[seg.key] === o.v;
                  return (
                    <button key={o.v} type="button" onClick={() => setModes({ ...modes, [seg.key]: o.v })}
                      aria-pressed={active}
                      /* ★ ট্যাপ-টার্গেট ৪০px — P2-তে বসানো মানদণ্ড।
                         অডিটে মাপা: এই তিনটি বোতাম ছিল **৩৪px** উঁচু, আর
                         P2-র পরেও প্রতিটি অ্যাডমিন ভিউপোর্টে অবশিষ্ট
                         ছোট-ট্যাপের বড় অংশ এখান থেকেই আসত (৯৬ হিট,
                         ২০২৬-০৮-২৫)। `py-1.5` এর বদলে `min-h` — উল্লম্ব
                         প্যাডিং দিয়ে বাড়ালে লেখা নিচে সরে যেত, তাই
                         `grid place-items-center` লেখাটিকে আগের মতোই
                         কেন্দ্রে রাখে; কেবল ছোঁয়ার জায়গা বাড়ে। */
                      className="grid min-h-[40px] place-items-center rounded-md px-3 text-[13px] font-bold transition"
                      style={active ? { background: '#7c3aed', color: '#fff' } : { color: 'var(--v-mut)' }}>
                      {o.t}
                    </button>
                  );
                })}
              </div>
              <p className="mt-1 text-[11.5px]" style={{ color: 'var(--v-dim)' }}>{seg.note}</p>
            </div>
          ))}
        </div>

        {autoSelected && !anyAutoProvider && (
          <p className="mt-4 text-[12px]" style={{ color: 'var(--v-heat)' }}>
            ⚠ অটোমেটিক বাছা হয়েছে কিন্তু কোনো সক্ষম+কনফিগার্ড গেটওয়ে চালু নেই — তাই এখন ম্যানুয়ালই চলবে।
            (উপরের <b>পেমেন্ট প্রোভাইডার</b> কার্ডে কী বসিয়ে গেটওয়ে চালু করুন।)
          </p>
        )}
      </div>

      <button onClick={save} disabled={busy} className="btn-primary">
        {busy ? 'সেভ হচ্ছে…' : 'ফুলফিলমেন্ট মোড সংরক্ষণ করুন'}
      </button>
    </div>
  );
}
