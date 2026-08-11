'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useToast } from '@/components/Toast';

/**
 * ★ রসিদের কাজগুলো — সংরক্ষণ ও ট্র্যাকিং লিংক (2.11)
 *
 *   কেন: টাকা পাঠানোর পর গ্রাহকের সবচেয়ে বড় দরকার একটি
 *   **স্থায়ী প্রমাণ** — যেটা সে রেখে দিতে পারে, বা পরে
 *   লগইন ছাড়াই খুলে দেখতে পারে (MANUAL_WORKFLOW.md A6)।
 */
export default function ReceiptActions({
  trackToken,
  orderId,
}: {
  trackToken: string | null;
  /** ★ Group I (২) — চালান পাতার লিংকের জন্য */
  orderId: string;
}) {
  const toast = useToast();
  const [copied, setCopied] = useState(false);

  async function copyTrackLink() {
    if (!trackToken) return;
    const url = `${window.location.origin}/track?t=${trackToken}`;
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      toast.success('ট্র্যাকিং লিংক কপি হয়েছে');
      setTimeout(() => setCopied(false), 2000);
    } catch {
      toast.error('কপি করা যায়নি');
    }
  }

  return (
    <div className="flex flex-wrap gap-2 print:hidden">
      {/* ★ Group I (২) — প্রকৃত চালান। এই পাতাটি প্রিন্ট করলে
          টাইমলাইন/SLA সহ পুরো স্ট্যাটাস পাতা কাগজে যেত, যা চালান নয়। */}
      <Link href={`/account/orders/${orderId}/invoice`} className="btn-ghost px-4 text-sm">
        🧾 চালান দেখুন
      </Link>

      <button onClick={() => window.print()} className="btn-ghost px-4 text-sm">
        🖨 রসিদ সংরক্ষণ
      </button>

      {trackToken && (
        <>
          <button onClick={copyTrackLink} className="btn-ghost px-4 text-sm">
            {copied ? '✓ কপি হয়েছে' : '🔗 ট্র্যাকিং লিংক কপি'}
          </button>
          <Link href={`/track?t=${trackToken}`} className="btn-ghost px-4 text-sm">
            লগইন ছাড়া ট্র্যাক
          </Link>
        </>
      )}

      <Link href="/contact" className="btn-ghost px-4 text-sm">
        সাপোর্টে যোগাযোগ
      </Link>
    </div>
  );
}
