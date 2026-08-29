'use client';

import { useState } from 'react';
import { useToast } from './Toast';
import Icon from '@/components/fx/Icon';

export default function ReferralCard({
  code, bonus, minDeposit, count,
}: {
  code: string;
  bonus: number;
  minDeposit: number;
  count: number;
}) {
  const toast = useToast();
  const [copied, setCopied] = useState<'code' | 'link' | null>(null);

  const link =
    typeof window !== 'undefined'
      ? `${window.location.origin}/register?ref=${code}`
      : `/register?ref=${code}`;

  function copy(text: string, what: 'code' | 'link') {
    navigator.clipboard
      .writeText(text)
      .then(() => {
        setCopied(what);
        toast.success(what === 'code' ? 'কোড কপি হয়েছে' : 'লিংক কপি হয়েছে');
        setTimeout(() => setCopied(null), 2000);
      })
      .catch(() => toast.error('কপি করা যায়নি'));
  }

  async function share() {
    const text = `SS UID TOPUP এ জয়েন করুন! আমার রেফারেল কোড: ${code}`;
    if (navigator.share) {
      try {
        await navigator.share({ title: 'SS UID TOPUP', text, url: link });
        return;
      } catch {
        // user cancelled — fallback
      }
    }
    copy(link, 'link');
  }

  return (
    <section className="card overflow-hidden">
      <div className="p-5">
        <div className="mb-4 flex items-start justify-between gap-3">
          <div>
            <h2 className="flex items-center gap-2 font-bold text-slate-900">
              <Icon name="gift" size={18} /> রেফার করে আয় করুন
            </h2>
            <p className="mt-1 text-sm leading-relaxed text-slate-600">
              বন্ধুকে আপনার কোড দিন। সে প্রথমবার ৳{minDeposit} বা তার বেশি ডিপোজিট করলে আপনি{' '}
              <strong className="text-emerald-600">৳{bonus}</strong> বোনাস পাবেন।
            </p>
          </div>
          {count > 0 && (
            <div
              className="shrink-0 rounded-lg px-3 py-1.5 text-center"
              style={{
                background: 'rgba(var(--gold-glow),.12)',
                border: '1px solid rgba(var(--gold-glow),.35)',
              }}
            >
              <p className="text-lg font-bold leading-none" style={{ color: 'var(--gold)' }}>{count}</p>
              <p className="mt-0.5 text-[10px]" style={{ color: 'var(--mut)' }}>রেফার</p>
            </div>
          )}
        </div>

        <div className="flex flex-col gap-2 sm:flex-row">
          <div
            className="flex flex-1 items-center gap-2 rounded-lg border-2 border-dashed px-4 py-3"
            style={{ borderColor: 'rgba(var(--gold-glow),.35)', background: 'var(--v-void)' }}
          >
            <code
              className="flex-1 select-all font-mono text-lg font-bold tracking-widest"
              style={{ color: 'var(--gold)' }}
            >
              {code}
            </code>
            <button
              onClick={() => copy(code, 'code')}
              aria-label="রেফারেল কোড কপি করুন"
              className="grid h-10 w-10 shrink-0 place-items-center rounded-md text-xs font-semibold transition hover:bg-white/10"
              style={{ color: 'var(--gold)' }}
            >
              <Icon name={copied === 'code' ? 'check' : 'copy'} size={16} />
            </button>
          </div>

          <button onClick={share} className="btn-ghost shrink-0 px-5">শেয়ার করুন</button>
        </div>
      </div>
    </section>
  );
}
