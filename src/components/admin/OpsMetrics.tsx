import { type OpsMetrics, humanMinutes } from '@/lib/opsMetrics';

/**
 * ★ অপারেশনাল মেট্রিক প্যানেল (3.10)
 *
 *   Server Component — কোনো ইন্টার‌্যাকশন নেই, তাই ক্লায়েন্টে
 *   পাঠানোর দরকার নেই (§7)।
 */

function Stat({
  label, value, hint, tone = 'normal',
}: {
  label: string;
  value: string;
  hint?: string;
  tone?: 'normal' | 'warn' | 'bad' | 'good';
}) {
  // ★ একই তিন-টোন লিটারেল (`CustomerTimeline`/`OrderTable` এও ছিল) —
  //   ভূমিকা-টোকেনে। এখানে সংখ্যাটিই বড় করে লেখা, তাই থিম-অন্ধ রঙ
  //   মানে লাইট থিমে সবচেয়ে গুরুত্বপূর্ণ সংখ্যাটিই সবচেয়ে ফ্যাকাশে।
  const color =
    tone === 'bad' ? 'var(--sem-danger)'
    : tone === 'warn' ? 'var(--sem-warning)'
    : tone === 'good' ? 'var(--sem-success)'
    : 'var(--ink)';
  return (
    <div className="rounded-xl border p-3.5" style={{ borderColor: 'var(--hair)' }}>
      <div className="text-[11px] font-semibold uppercase tracking-wide" style={{ color: 'var(--mut)' }}>
        {label}
      </div>
      <div className="mt-1 text-lg font-bold" style={{ color }}>{value}</div>
      {hint && <div className="mt-0.5 text-[11px]" style={{ color: 'var(--mut)' }}>{hint}</div>}
    </div>
  );
}

export default function OpsMetricsPanel({ m }: { m: OpsMetrics }) {
  return (
    <section className="space-y-3">
      <div>
        <div className="eyebrow">অপারেশন</div>
        <div className="rule-gold" />
      </div>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-3">
        <Stat
          label="সময় পেরিয়েছে"
          value={`${m.slaBreached} টি`}
          hint={m.slaSoon > 0 ? `আরও ${m.slaSoon} টির সময় ঘনিয়ে এসেছে` : undefined}
          tone={m.slaBreached > 0 ? 'bad' : 'good'}
        />
        <Stat
          label="সবচেয়ে পুরনো অর্ডার"
          value={m.oldestPendingOrderMin === null ? '—' : humanMinutes(m.oldestPendingOrderMin)}
          hint={m.oldestPendingOrderMin === null ? 'কোনো অপেক্ষমাণ অর্ডার নেই' : 'ধরে অপেক্ষা করছে'}
          tone={
            m.oldestPendingOrderMin === null ? 'good'
            : m.oldestPendingOrderMin > 120 ? 'bad'
            : m.oldestPendingOrderMin > 30 ? 'warn'
            : 'normal'
          }
        />
        <Stat
          label="সবচেয়ে পুরনো ডিপোজিট"
          value={m.oldestPendingDepositMin === null ? '—' : humanMinutes(m.oldestPendingDepositMin)}
          hint={m.oldestPendingDepositMin === null ? 'সব যাচাই হয়ে গেছে' : 'যাচাইয়ের অপেক্ষায়'}
          tone={
            m.oldestPendingDepositMin === null ? 'good'
            : m.oldestPendingDepositMin > 120 ? 'bad'
            : m.oldestPendingDepositMin > 30 ? 'warn'
            : 'normal'
          }
        />

        {/* ★★★ যথেষ্ট নমুনা না থাকলে সংখ্যার বদলে সৎ কথা।
                ২টা অর্ডার থেকে "মধ্যক ৪ মিনিট" দেখালে সেটা
                তথ্য নয়, কাকতাল — আর সেই ভুল সংখ্যাই পরে
                সিদ্ধান্তের ভিত্তি হয়ে যায় (2.9 এর মতোই)। */}
        <Stat
          label="মধ্যক ডেলিভারি সময়"
          value={m.medianFulfilMin === null ? 'যথেষ্ট তথ্য নেই' : humanMinutes(m.medianFulfilMin)}
          hint={
            m.medianFulfilMin === null
              ? `${m.minSample} টির কম (${m.fulfilSample} টি)`
              : `শেষ ${m.windowDays} দিনে ${m.fulfilSample} টি অর্ডার`
          }
        />
        <Stat
          label="মধ্যক যাচাই সময়"
          value={m.medianApprovalMin === null ? 'যথেষ্ট তথ্য নেই' : humanMinutes(m.medianApprovalMin)}
          hint={
            m.medianApprovalMin === null
              ? `${m.minSample} টির কম (${m.approvalSample} টি)`
              : `শেষ ${m.windowDays} দিনে ${m.approvalSample} টি ডিপোজিট`
          }
        />
        <Stat
          label="আজ সম্পন্ন"
          value={`${m.todayCompleted} অর্ডার`}
          hint={`${m.todayApproved} টি ডিপোজিট অনুমোদন`}
        />
      </div>
    </section>
  );
}
