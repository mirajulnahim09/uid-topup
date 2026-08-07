'use client';

import { useEffect, useState, useCallback } from 'react';
import { useToast } from '@/components/Toast';

/** ★ ডেলিভারি লগ ও ব্যবহার-বিশ্লেষণ — সব সংখ্যা লগ থেকে হিসাব করা। */

type Bucket = { sent: number; failed: number; successRate: number };
type Data = {
  today: Bucket; week: Bucket; month: Bucket; allTime: Bucket;
  avgLatencyMs: number | null; p95LatencyMs: number | null;
  totalRetries: number; totalBytes: number;
  daily: { date: string; sent: number; failed: number }[];
  perBot: { botId: string; label: string; sent: number; failed: number; successRate: number; avgLatencyMs: number }[];
  recent: {
    id: string; botId: string; botLabel: string; event: string | null; ok: boolean;
    status: number | null; latencyMs: number; attempts: number; bytes: number;
    error: string | null; response: string | null; trigger: string; createdAt: string;
  }[];
};

const when = (iso: string) => {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '—' : d.toLocaleString('bn-BD', { dateStyle: 'short', timeStyle: 'medium' });
};
const kb = (n: number) => n < 1024 ? `${n} B` : `${(n / 1024).toFixed(1)} KB`;

function Tile({ label, b }: { label: string; b: Bucket }) {
  return (
    <div className="rounded-xl p-3" style={{ background: 'var(--v-steel)' }}>
      <p className="text-[11px]" style={{ color: 'var(--v-dim)' }}>{label}</p>
      <p className="mt-0.5 text-[19px] font-bold tabular-nums" style={{ color: 'var(--v-ink)' }}>{b.sent}</p>
      <p className="text-[10.5px]" style={{ color: b.failed ? 'var(--v-heat)' : 'var(--v-dim)' }}>
        ব্যর্থ {b.failed} · {b.successRate}%
      </p>
    </div>
  );
}

export default function AnalyticsPanel() {
  const toast = useToast();
  const [d, setD] = useState<Data | null>(null);

  const load = useCallback(async () => {
    try {
      const r = await fetch('/api/admin/telegram/analytics');
      if (!r.ok) throw new Error();
      setD(await r.json());
    } catch { toast.error('বিশ্লেষণ আনা যায়নি'); }
  }, [toast]);

  useEffect(() => { void load(); }, [load]);

  if (!d) return <div className="card p-5 text-[13px]" style={{ color: 'var(--v-mut)' }}>লোড হচ্ছে…</div>;

  const maxDay = Math.max(1, ...d.daily.map((x) => x.sent + x.failed));

  return (
    <div className="space-y-4">
      <div className="card p-4 sm:p-5">
        <h3 className="text-[15px] font-bold" style={{ color: 'var(--v-ink)' }}>ব্যবহার</h3>
        <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
          <Tile label="আজ" b={d.today} />
          <Tile label="৭ দিন" b={d.week} />
          <Tile label="৩০ দিন" b={d.month} />
          <Tile label="সর্বমোট" b={d.allTime} />
        </div>
        <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-4">
          <div className="rounded-xl p-3" style={{ background: 'var(--v-steel)' }}>
            <p className="text-[11px]" style={{ color: 'var(--v-dim)' }}>গড় লেটেন্সি</p>
            <p className="mt-0.5 text-[17px] font-bold tabular-nums" style={{ color: 'var(--v-ink)' }}>
              {d.avgLatencyMs !== null ? `${d.avgLatencyMs}ms` : '—'}
            </p>
          </div>
          <div className="rounded-xl p-3" style={{ background: 'var(--v-steel)' }}>
            <p className="text-[11px]" style={{ color: 'var(--v-dim)' }}>p95 লেটেন্সি</p>
            <p className="mt-0.5 text-[17px] font-bold tabular-nums" style={{ color: 'var(--v-ink)' }}>
              {d.p95LatencyMs !== null ? `${d.p95LatencyMs}ms` : '—'}
            </p>
          </div>
          <div className="rounded-xl p-3" style={{ background: 'var(--v-steel)' }}>
            <p className="text-[11px]" style={{ color: 'var(--v-dim)' }}>পুনঃচেষ্টা</p>
            <p className="mt-0.5 text-[17px] font-bold tabular-nums" style={{ color: 'var(--v-ink)' }}>{d.totalRetries}</p>
          </div>
          <div className="rounded-xl p-3" style={{ background: 'var(--v-steel)' }}>
            <p className="text-[11px]" style={{ color: 'var(--v-dim)' }}>মোট আকার</p>
            <p className="mt-0.5 text-[17px] font-bold tabular-nums" style={{ color: 'var(--v-ink)' }}>{kb(d.totalBytes)}</p>
          </div>
        </div>
      </div>

      {/* দৈনিক বার — CSS দিয়েই, কোনো চার্ট লাইব্রেরি যোগ করা হয়নি */}
      {d.daily.length > 0 && (
        <div className="card p-4 sm:p-5">
          <h3 className="text-[15px] font-bold" style={{ color: 'var(--v-ink)' }}>দৈনিক (১৪ দিন)</h3>
          <div className="mt-3 flex items-end gap-1.5" style={{ height: 96 }}>
            {d.daily.map((x) => {
              const total = x.sent + x.failed;
              return (
                <div key={x.date} className="flex min-w-0 flex-1 flex-col items-center justify-end gap-1"
                  title={`${x.date}: ${x.sent} সফল, ${x.failed} ব্যর্থ`}>
                  <div className="w-full rounded-t" style={{
                    height: `${Math.max(3, (total / maxDay) * 76)}px`,
                    background: x.failed > 0 ? 'var(--v-heat)' : 'var(--v-volt)',
                    opacity: 0.85,
                  }} />
                  <span className="truncate text-[9px]" style={{ color: 'var(--v-dim)' }}>
                    {x.date.slice(8)}
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {d.perBot.length > 0 && (
        <div className="card p-4 sm:p-5">
          <h3 className="text-[15px] font-bold" style={{ color: 'var(--v-ink)' }}>বট অনুযায়ী</h3>
          <div className="mt-2 overflow-x-auto">
            <table className="tbl w-full text-[11.5px]">
              <thead><tr>
                <th>বট</th><th>পাঠানো</th>
                <th>ব্যর্থ</th><th>সাফল্য</th><th>গড়</th>
              </tr></thead>
              <tbody>
                {d.perBot.map((p) => (
                  <tr key={p.botId}>
                    <td className="font-semibold">{p.label}</td>
                    <td>{p.sent}</td>
                    <td style={{ color: p.failed ? 'var(--v-heat)' : undefined }}>{p.failed}</td>
                    <td style={{ color: 'var(--v-volt)' }}>{p.successRate}%</td>
                    <td>{p.avgLatencyMs}ms</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <div className="card p-4 sm:p-5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="text-[15px] font-bold" style={{ color: 'var(--v-ink)' }}>সাম্প্রতিক ডেলিভারি</h3>
          <button onClick={load} className="btn-ghost px-3 py-1.5 text-[11px] font-bold">↻ রিফ্রেশ</button>
        </div>
        {d.recent.length === 0 ? (
          <p className="mt-2 text-[12px]" style={{ color: 'var(--v-dim)' }}>এখনো কোনো বার্তা পাঠানো হয়নি।</p>
        ) : (
          <div className="mt-2 overflow-x-auto">
            <table className="tbl w-full text-[11px]">
              <thead><tr>
                <th>সময়</th><th>বট</th>
                <th>ইভেন্ট</th><th>অবস্থা</th>
                <th>লেটেন্সি</th><th>চেষ্টা</th>
                <th>আকার</th><th>রেসপন্স</th>
              </tr></thead>
              <tbody>
                {d.recent.map((r) => (
                  <tr key={r.id}>
                    <td>{when(r.createdAt)}</td>
                    <td>{r.botLabel}</td>
                    <td>{r.event ?? r.trigger}</td>
                    <td style={{ color: r.ok ? 'var(--v-volt)' : 'var(--v-heat)' }}>
                      {r.ok ? '✓ পৌঁছেছে' : '✕ ব্যর্থ'}{r.status ? ` (${r.status})` : ''}
                    </td>
                    <td>{r.latencyMs}ms</td>
                    <td>{r.attempts}</td>
                    <td>{kb(r.bytes)}</td>
                    <td style={{ color: r.error ? 'var(--v-heat)' : 'var(--v-mut)' }}>
                      {(r.error || r.response || '—').slice(0, 44)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
