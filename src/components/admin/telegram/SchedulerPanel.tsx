'use client';

import { useEffect, useState, useCallback } from 'react';
import { useToast } from '@/components/Toast';

/** ★ শিডিউলার ড্যাশবোর্ড — আসন্ন/চলমান/সম্পন্ন/ব্যর্থ জব ও ইতিহাস। */

type Job = {
  key: string; label: string; description: string | null;
  enabled: boolean; status: string;
  kind: string; atHour: number; atMinute: number;
  weekday: number | null; dayOfMonth: number | null; timezone: string;
  runOnceAt: string | null; nextRunAt: string | null; lastRunAt: string | null;
  lastStatus: string | null; lastError: string | null; lastMs: number | null;
  runCount: number; failCount: number; avgMs: number | null; hasHandler: boolean;
};
type Run = {
  id: string; jobKey: string; trigger: string; status: string;
  startedAt: string; finishedAt: string | null; ms: number | null;
  detail: string | null; error: string | null;
};
type Data = {
  schedulerRunning: boolean; timezone: string; kinds: string[];
  summary: { total: number; enabled: number; running: number; paused: number; completed: number; failed: number };
  jobs: Job[]; history: Run[];
};

const KIND_LABEL: Record<string, string> = {
  ONCE: 'একবার', HOURLY: 'প্রতি ঘণ্টায়', DAILY: 'প্রতিদিন',
  WEEKLY: 'সাপ্তাহিক', MONTHLY: 'মাসিক',
};
const WEEKDAYS = ['রবি', 'সোম', 'মঙ্গল', 'বুধ', 'বৃহঃ', 'শুক্র', 'শনি'];
const TZS = ['Asia/Dhaka', 'Asia/Kolkata', 'Asia/Dubai', 'Europe/London', 'America/New_York', 'UTC'];

const when = (iso: string | null) => {
  if (!iso) return '—';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '—' : d.toLocaleString('bn-BD', { dateStyle: 'short', timeStyle: 'short' });
};
const rel = (iso: string | null) => {
  if (!iso) return '';
  const s = Math.round((new Date(iso).getTime() - Date.now()) / 1000);
  if (Number.isNaN(s)) return '';
  const abs = Math.abs(s);
  const txt = abs < 60 ? `${abs} সেকেন্ড` : abs < 3600 ? `${Math.round(abs / 60)} মিনিট`
    : abs < 86400 ? `${Math.round(abs / 3600)} ঘণ্টা` : `${Math.round(abs / 86400)} দিন`;
  return s >= 0 ? `${txt} পরে` : `${txt} আগে`;
};

function Stat({ label, value, tone }: { label: string; value: number | string; tone?: string }) {
  return (
    <div className="rounded-xl p-3" style={{ background: 'var(--v-steel)' }}>
      <p className="text-[11px]" style={{ color: 'var(--v-dim)' }}>{label}</p>
      <p className="mt-0.5 text-[19px] font-bold tabular-nums" style={{ color: tone || 'var(--v-ink)' }}>{value}</p>
    </div>
  );
}

export default function SchedulerPanel() {
  const toast = useToast();
  const [d, setD] = useState<Data | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [editing, setEditing] = useState<Job | null>(null);

  const load = useCallback(async () => {
    try {
      const r = await fetch('/api/admin/telegram/scheduler');
      if (!r.ok) throw new Error();
      setD(await r.json());
    } catch { toast.error('শিডিউলার তথ্য আনা যায়নি'); }
  }, [toast]);

  useEffect(() => { void load(); }, [load]);

  async function act(payload: Record<string, unknown>, label: string, tag: string) {
    setBusy(tag);
    try {
      const r = await fetch('/api/admin/telegram/scheduler', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || `${label} ব্যর্থ`);
      toast.success(j.message || `${label} সফল`);
      await load();
      return true;
    } catch (e) {
      toast.error(e instanceof Error ? e.message : `${label} ব্যর্থ`);
      return false;
    } finally { setBusy(null); }
  }

  if (!d) return <div className="card p-5 text-[13px]" style={{ color: 'var(--v-mut)' }}>লোড হচ্ছে…</div>;

  return (
    <div className="space-y-4">
      <div className="card p-4 sm:p-5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="text-[15px] font-bold" style={{ color: 'var(--v-ink)' }}>শিডিউলার</h3>
          <span className="rounded-full px-3 py-1 text-[11px] font-bold"
            style={{
              background: 'var(--v-steel)',
              color: d.schedulerRunning ? 'var(--v-volt)' : 'var(--v-heat)',
              border: `1px solid ${d.schedulerRunning ? 'var(--v-volt)' : 'var(--v-heat)'}`,
            }}>
            ● {d.schedulerRunning ? 'ইঞ্জিন চলছে' : 'ইঞ্জিন বন্ধ'}
          </span>
        </div>

        <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
          <Stat label="মোট জব" value={d.summary.total} />
          <Stat label="চালু" value={d.summary.enabled} tone="var(--v-volt)" />
          <Stat label="চলমান" value={d.summary.running} />
          <Stat label="বিরতি" value={d.summary.paused} />
          <Stat label="সম্পন্ন" value={d.summary.completed} tone="var(--v-volt)" />
          <Stat label="ব্যর্থ" value={d.summary.failed} tone={d.summary.failed ? 'var(--v-heat)' : undefined} />
        </div>

        <div className="mt-3 flex flex-wrap gap-2">
          <button onClick={() => act({ action: 'tick' }, 'টিক', 'tick')} disabled={busy !== null}
            className="btn-ghost wz-cta px-4 py-2 text-xs font-bold disabled:opacity-50">
            {busy === 'tick' ? 'চলছে…' : '⏱️ এখনই টিক চালান'}
          </button>
          <button onClick={() => act({ action: 'retry-failed' }, 'পুনরায়', 'retry')} disabled={busy !== null}
            className="btn-ghost wz-cta px-4 py-2 text-xs font-bold disabled:opacity-50">
            🔁 ব্যর্থ জব আবার চালান
          </button>
        </div>

        <p className="mt-2 text-[11px] leading-relaxed" style={{ color: 'var(--v-dim)' }}>
          ইঞ্জিন প্রতি ৩০ সেকেন্ডে বকেয়া জব দেখে। Serverless-এ প্রক্রিয়া টেকে না, তাই সেখানে
          বাইরের cron দিয়ে <code>POST /api/admin/telegram/scheduler/tick</code> ডাকুন
          (<code>CRON_SECRET</code> সেট করে <code>Authorization: Bearer …</code>)।
        </p>
      </div>

      {/* ═══ জব তালিকা ═══ */}
      <div className="space-y-2">
        {d.jobs.map((j) => (
          <div key={j.key} className="card wz-rise p-3.5">
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-[13.5px] font-bold" style={{ color: 'var(--v-ink)' }}>{j.label}</span>
                  <span className="rounded px-1.5 py-0.5 text-[10px] font-bold"
                    style={{ background: 'var(--v-steel)', color: 'var(--v-mut)' }}>
                    {KIND_LABEL[j.kind] ?? j.kind}
                  </span>
                  <span className="rounded-full px-2 py-0.5 text-[10px] font-bold"
                    style={{
                      background: j.enabled ? 'var(--tint-volt)' : 'var(--tint-violet)',
                      color: 'var(--v-ink)',
                    }}>
                    {j.status === 'RUNNING' ? '⏳ চলছে' : j.enabled ? '● চালু' : '⏸ বিরতি'}
                  </span>
                  {!j.hasHandler && (
                    <span className="rounded px-1.5 py-0.5 text-[10px]" style={{ background: 'var(--tint-ice)', color: 'var(--v-mut)' }}>
                      হ্যান্ডলার নেই
                    </span>
                  )}
                </div>
                <div className="mt-1 flex flex-wrap gap-x-4 gap-y-0.5 text-[11px]" style={{ color: 'var(--v-mut)' }}>
                  <span>পরবর্তী: <b style={{ color: 'var(--v-ink)' }}>{when(j.nextRunAt)}</b> {j.nextRunAt && <em style={{ color: 'var(--v-dim)' }}>({rel(j.nextRunAt)})</em>}</span>
                  <span>শেষ: {when(j.lastRunAt)}</span>
                  {j.lastStatus && (
                    <span style={{ color: j.lastStatus === 'SUCCESS' ? 'var(--v-volt)' : 'var(--v-heat)' }}>
                      {j.lastStatus === 'SUCCESS' ? '✓ সফল' : '✕ ব্যর্থ'}
                    </span>
                  )}
                  <span>রান {j.runCount} / ব্যর্থ {j.failCount}</span>
                  {j.avgMs !== null && <span>গড় {j.avgMs}ms</span>}
                </div>
                {j.lastError && (
                  <p className="mt-1 text-[11px]" style={{ color: 'var(--v-heat)' }}>{j.lastError}</p>
                )}
              </div>
            </div>

            <div className="mt-2.5 flex flex-wrap gap-1.5">
              <button onClick={() => act({ action: 'run', key: j.key }, 'রান', `run-${j.key}`)}
                disabled={busy !== null || !j.hasHandler}
                className="btn-ghost px-3 py-1.5 text-[11px] font-bold disabled:opacity-40">
                {busy === `run-${j.key}` ? '…' : '▶ এখনই চালান'}
              </button>
              <button onClick={() => act({ action: j.enabled ? 'pause' : 'resume', key: j.key }, j.enabled ? 'বিরতি' : 'চালু', `p-${j.key}`)}
                disabled={busy !== null}
                className="btn-ghost px-3 py-1.5 text-[11px] font-bold disabled:opacity-40">
                {j.enabled ? '⏸ বিরতি' : '▶ চালু'}
              </button>
              <button onClick={() => act({ action: 'stop', key: j.key }, 'বন্ধ', `s-${j.key}`)}
                disabled={busy !== null}
                className="btn-ghost px-3 py-1.5 text-[11px] font-bold disabled:opacity-40">
                ⏹ বন্ধ
              </button>
              <button onClick={() => setEditing(editing?.key === j.key ? null : j)}
                className="btn-ghost px-3 py-1.5 text-[11px] font-bold">
                🕒 সময়সূচি
              </button>
            </div>

            {editing?.key === j.key && (
              <ScheduleEditor job={j} kinds={d.kinds} busy={busy !== null}
                onCancel={() => setEditing(null)}
                onSave={async (payload) => {
                  const ok = await act({ action: 'save', key: j.key, ...payload }, 'সময়সূচি', `save-${j.key}`);
                  if (ok) setEditing(null);
                }} />
            )}
          </div>
        ))}
      </div>

      {/* ═══ ইতিহাস ═══ */}
      <div className="card p-4 sm:p-5">
        <h3 className="text-[15px] font-bold" style={{ color: 'var(--v-ink)' }}>চালানোর ইতিহাস</h3>
        {d.history.length === 0 ? (
          <p className="mt-2 text-[12px]" style={{ color: 'var(--v-dim)' }}>এখনো কোনো জব চলেনি।</p>
        ) : (
          <div className="mt-2 overflow-x-auto">
            <table className="tbl w-full text-[11.5px]">
              <thead>
                <tr>
                  <th>জব</th><th>ট্রিগার</th>
                  <th>অবস্থা</th><th>সময়</th>
                  <th>সময়কাল</th><th>বিবরণ</th>
                </tr>
              </thead>
              <tbody>
                {d.history.map((r) => (
                  <tr key={r.id}>
                    <td className="font-semibold">{r.jobKey}</td>
                    <td>{r.trigger}</td>
                    <td style={{ color: r.status === 'SUCCESS' ? 'var(--v-volt)' : r.status === 'FAILED' ? 'var(--v-heat)' : 'var(--v-mut)' }}>
                      {r.status}
                    </td>
                    <td>{when(r.startedAt)}</td>
                    <td>{r.ms != null ? `${r.ms}ms` : '—'}</td>
                    <td style={{ color: r.error ? 'var(--v-heat)' : 'var(--v-mut)' }}>
                      {(r.error || r.detail || '—').slice(0, 60)}
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

function ScheduleEditor({ job, kinds, busy, onSave, onCancel }: {
  job: Job; kinds: string[]; busy: boolean;
  onSave: (p: Record<string, unknown>) => void; onCancel: () => void;
}) {
  const [kind, setKind] = useState(job.kind);
  const [h, setH] = useState(job.atHour);
  const [m, setM] = useState(job.atMinute);
  const [wd, setWd] = useState(job.weekday ?? 5);
  const [dom, setDom] = useState(job.dayOfMonth ?? 1);
  const [tz, setTz] = useState(job.timezone);
  const [once, setOnce] = useState(job.runOnceAt ? job.runOnceAt.slice(0, 16) : '');

  return (
    <div className="wz-rise mt-3 rounded-lg p-3" style={{ background: 'var(--v-steel)' }}>
      <div className="grid gap-2.5 sm:grid-cols-2 lg:grid-cols-4">
        <div>
          <label className="label" htmlFor={`k-${job.key}`}>পুনরাবৃত্তি</label>
          <select id={`k-${job.key}`} className="input" value={kind} onChange={(e) => setKind(e.target.value)}>
            {kinds.map((k) => <option key={k} value={k}>{KIND_LABEL[k] ?? k}</option>)}
          </select>
        </div>

        {kind === 'ONCE' ? (
          <div className="sm:col-span-2">
            <label className="label" htmlFor={`o-${job.key}`}>তারিখ ও সময়</label>
            <input id={`o-${job.key}`} type="datetime-local" className="input"
              value={once} onChange={(e) => setOnce(e.target.value)} />
          </div>
        ) : (
          <>
            {kind !== 'HOURLY' && (
              <div>
                <label className="label" htmlFor={`h-${job.key}`}>ঘণ্টা (০–২৩)</label>
                <input id={`h-${job.key}`} type="number" min={0} max={23} className="input"
                  value={h} onChange={(e) => setH(Number(e.target.value))} />
              </div>
            )}
            <div>
              <label className="label" htmlFor={`m-${job.key}`}>মিনিট (০–৫৯)</label>
              <input id={`m-${job.key}`} type="number" min={0} max={59} className="input"
                value={m} onChange={(e) => setM(Number(e.target.value))} />
            </div>
            {kind === 'WEEKLY' && (
              <div>
                <label className="label" htmlFor={`w-${job.key}`}>সপ্তাহের দিন</label>
                <select id={`w-${job.key}`} className="input" value={wd} onChange={(e) => setWd(Number(e.target.value))}>
                  {WEEKDAYS.map((w, i) => <option key={w} value={i}>{w}</option>)}
                </select>
              </div>
            )}
            {kind === 'MONTHLY' && (
              <div>
                <label className="label" htmlFor={`d-${job.key}`}>মাসের দিন (১–২৮)</label>
                <input id={`d-${job.key}`} type="number" min={1} max={28} className="input"
                  value={dom} onChange={(e) => setDom(Number(e.target.value))} />
              </div>
            )}
          </>
        )}

        <div>
          <label className="label" htmlFor={`tz-${job.key}`}>টাইমজোন</label>
          <select id={`tz-${job.key}`} className="input" value={tz} onChange={(e) => setTz(e.target.value)}>
            {TZS.map((z) => <option key={z} value={z}>{z}</option>)}
          </select>
        </div>
      </div>

      <p className="mt-1.5 text-[10.5px]" style={{ color: 'var(--v-dim)' }}>
        মাসিক জব সর্বোচ্চ ২৮ তারিখ পর্যন্ত — ৩১ দিলে ফেব্রুয়ারিতে কখনো চলত না।
      </p>

      <div className="mt-2.5 flex flex-wrap gap-2">
        <button onClick={onCancel} className="btn-ghost px-3 py-1.5 text-[11px] font-bold">বাতিল</button>
        <button disabled={busy}
          onClick={() => onSave({
            kind, atHour: h, atMinute: m,
            weekday: kind === 'WEEKLY' ? wd : null,
            dayOfMonth: kind === 'MONTHLY' ? dom : null,
            timezone: tz,
            runOnceAt: kind === 'ONCE' && once ? new Date(once).toISOString() : null,
            enabled: true,
          })}
          className="btn-primary wz-cta ml-auto px-4 py-1.5 text-[11px] font-bold disabled:opacity-50">
          সংরক্ষণ ও চালু
        </button>
      </div>
    </div>
  );
}
