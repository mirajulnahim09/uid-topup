'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import ConnectionWizard from './ConnectionWizard';
import TelegramDashboard, { type DashboardData } from './TelegramDashboard';

/**
 * ★ কনফিগ না থাকলে **স্বয়ংক্রিয়ভাবে** Connection Wizard, নাহলে ড্যাশবোর্ড।
 *
 *   কেন আলাদা কম্পোনেন্ট: সিদ্ধান্তটি ক্লায়েন্টে থাকা দরকার, কারণ
 *   উইজার্ড শেষ হলে ব্যবহারকারী **পাতা রিলোড না করেই** ড্যাশবোর্ডে
 *   যেতে পারবে। সার্ভারে সিদ্ধান্ত নিলে প্রতিবার রাউন্ড-ট্রিপ লাগত।
 *
 *   অ্যাডমিন চাইলে "পরে করব" চেপে উইজার্ড বন্ধ করে ড্যাশবোর্ড দেখতে
 *   পারে — জোর করে আটকে রাখা হয় না।
 */
export default function TelegramGate({ initial }: { initial: DashboardData }) {
  const router = useRouter();
  // ★ কনফিগার করা না থাকলে উইজার্ড দিয়েই শুরু
  const [showWizard, setShowWizard] = useState(!initial.connection.configured);

  if (showWizard) {
    return (
      <div className="space-y-3">
        {!initial.connection.configured && (
          <p className="rounded-xl p-3 text-[12px] leading-relaxed"
            style={{ background: 'var(--tint-ice)', color: 'var(--v-ink)' }}>
            👋 টেলিগ্রাম এখনো কনফিগার করা হয়নি — নিচের সহায়িকা অনুসরণ করুন (~২ মিনিট)।
          </p>
        )}
        <ConnectionWizard
          initialEvents={initial.events}
          onClose={() => { setShowWizard(false); router.refresh(); }}
        />
      </div>
    );
  }

  return <TelegramDashboard initial={initial} />;
}
