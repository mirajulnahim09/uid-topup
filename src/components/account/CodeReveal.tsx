'use client';

import { useState } from 'react';
import { useToast } from '@/components/Toast';

/** Shows a delivered voucher code hidden by default, with reveal + copy. */
export default function CodeReveal({ code }: { code: string }) {
  const [shown, setShown] = useState(false);
  const toast = useToast();

  async function copy() {
    try {
      await navigator.clipboard.writeText(code);
      toast.success('কোড কপি হয়েছে');
    } catch {
      setShown(true);
      toast.error('কপি করা যায়নি — কোডটি হাতে কপি করুন');
    }
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <code
        className="min-w-0 flex-1 select-all break-all rounded-xl px-3 py-2.5 font-mono text-[15px] font-bold tracking-wider"
        style={{ background: 'var(--v-steel)', color: 'var(--v-ink)', border: '1px dashed var(--v-edge2)' }}
      >
        {shown ? code : '•'.repeat(Math.min(16, Math.max(8, code.length)))}
      </code>
      <button type="button" className="btn btn-ghost min-h-[42px] px-3 text-xs" onClick={() => setShown((s) => !s)}>
        {shown ? 'লুকান' : 'দেখুন'}
      </button>
      <button type="button" className="btn btn-primary min-h-[42px] px-3 text-xs" onClick={copy}>
        কপি
      </button>
    </div>
  );
}
