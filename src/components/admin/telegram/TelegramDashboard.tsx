'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useToast, ConfirmDialog } from '@/components/Toast';
import ConnectionWizard, { type WizardEvent } from './ConnectionWizard';
import BotsPanel from './BotsPanel';
import SchedulerPanel from './SchedulerPanel';
import TemplatesPanel from './TemplatesPanel';
import AnalyticsPanel from './AnalyticsPanel';
import BackupPanel from './BackupPanel';

/**
 * ★ ট্যাব — প্রতিটি প্যানেল **নিজের ডেটা নিজে আনে** (mount হলে)।
 *   সবকিছু সার্ভার-পাতায় একসাথে আনলে প্রথম রেন্ডারে ৬টি ভারী কোয়েরি
 *   লাগত, অথচ অ্যাডমিন সাধারণত একটি ট্যাবই দেখে।
 */
const TABS = [
  { id: 'overview', label: '📊 সংক্ষেপ' },
  { id: 'bots', label: '🤖 বট' },
  { id: 'scheduler', label: '⏰ শিডিউলার' },
  { id: 'templates', label: '✍️ টেমপ্লেট' },
  { id: 'analytics', label: '📈 বিশ্লেষণ' },
  { id: 'backup', label: '💾 ব্যাকআপ' },
] as const;
type TabId = (typeof TABS)[number]['id'];

/**
 * ★★★ টেলিগ্রাম ড্যাশবোর্ড
 *
 *   ⚠️ এই কম্পোনেন্টে বট টোকেন **কখনো** আসে না — শুধু মাস্কড রূপ
 *   (`tokenMasked`)। ক্লায়েন্ট কম্পোনেন্টের props RSC payload-এ
 *   সিরিয়ালাইজ হয়ে ব্রাউজারে যায়, তাই এটাই একমাত্র নিরাপদ নকশা।
 */

export type DashboardData = {
  connection: {
    configured: boolean; connected: boolean; tokenValid: boolean; unreachable: boolean;
    hasToken: boolean; hasChatId: boolean; error: string | null; latencyMs: number;
    source: 'db' | 'env' | null;
    botName: string | null; botUsername: string | null; botId: number | null;
    photoUrl: string | null;
  };
  bots: {
    id: string; role: string; label: string; enabled: boolean;
    tokenMasked: string; chatIdMasked: string; hasToken: boolean; hasChatId: boolean;
    username: string | null; name: string | null; botId: number | null;
    photoUrl: string | null; source: 'db' | 'env';
  }[];
  stats: {
    totalSent: number; totalFailed: number; totalRetries: number;
    lastOkAt: string | null; lastOkEvent: string | null;
    lastFailAt: string | null; lastFailError: string | null;
    lastApiResponse: string | null; lastCheckAt: string | null;
    lastLatencyMs: number | null; connectedAt: string | null;
  };
  enabled: boolean;
  events: WizardEvent[];
  storage: { dbConfigured: boolean; encryptionReady: boolean; source: 'db' | 'env' | null };
};

const GROUP_ORDER = ['money', 'order', 'user', 'system', 'digest'];
const GROUP_LABEL: Record<string, string> = {
  money: '💰 টাকা', order: '📦 অর্ডার', user: '👤 ইউজার',
  system: '⚙️ সিস্টেম', digest: '📊 সারসংক্ষেপ',
};

function ago(iso: string | null): string {
  if (!iso) return '—';
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return '—';
  const s = Math.floor((Date.now() - t) / 1000);
  if (s < 60) return 'এইমাত্র';
  if (s < 3600) return `${Math.floor(s / 60)} মিনিট আগে`;
  if (s < 86400) return `${Math.floor(s / 3600)} ঘণ্টা আগে`;
  return `${Math.floor(s / 86400)} দিন আগে`;
}
const fullTime = (iso: string | null) => {
  if (!iso) return '';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleString('bn-BD');
};

function Stat({ label, value, tone }: { label: string; value: string | number; tone?: string }) {
  return (
    <div className="rounded-xl p-3" style={{ background: 'var(--v-steel)' }}>
      <p className="text-[11px]" style={{ color: 'var(--v-dim)' }}>{label}</p>
      <p className="mt-0.5 text-[19px] font-bold tabular-nums"
        style={{ color: tone || 'var(--v-ink)' }}>{value}</p>
    </div>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-2 border-b py-2.5 last:border-b-0"
      style={{ borderColor: 'var(--v-edge)' }}>
      <span className="text-[12.5px]" style={{ color: 'var(--v-mut)' }}>{label}</span>
      <span className="text-[12.5px] font-semibold" style={{ color: 'var(--v-ink)' }}>{children}</span>
    </div>
  );
}

export default function TelegramDashboard({ initial }: { initial: DashboardData }) {
  const toast = useToast();
  const router = useRouter();

  const [data, setData] = useState(initial);
  const [events, setEvents] = useState<WizardEvent[]>(initial.events);
  const [enabled, setEnabled] = useState(initial.enabled);
  const [busy, setBusy] = useState<string | null>(null);
  const [wizard, setWizard] = useState(false);
  const [confirmReset, setConfirmReset] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [tab, setTab] = useState<TabId>('overview');

  const c = data.connection;
  const s = data.stats;

  const dirty =
    enabled !== data.enabled ||
    events.some((e) => data.events.find((x) => x.key === e.key)?.enabled !== e.enabled);

  async function refresh() {
    const res = await fetch('/api/admin/telegram');
    if (!res.ok) return;
    const d = (await res.json()) as DashboardData;
    setData(d);
    setEvents(d.events);
    setEnabled(d.enabled);
  }

  async function act(action: string, label: string) {
    setBusy(action);
    try {
      const res = await fetch('/api/admin/telegram/manage', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action }),
      });
      const d = await res.json();
      if (!res.ok) throw new Error(d.error || `${label} ব্যর্থ`);
      toast.success(d.message || `${label} সফল`);
      await refresh();
      router.refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : `${label} ব্যর্থ`);
    } finally { setBusy(null); }
  }

  async function savePrefs() {
    setBusy('prefs');
    try {
      const res = await fetch('/api/admin/telegram', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled, events: Object.fromEntries(events.map((e) => [e.key, e.enabled])) }),
      });
      const d = await res.json();
      if (!res.ok) throw new Error(d.error || 'সেভ ব্যর্থ');
      toast.success('পছন্দ সংরক্ষিত');
      await refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'সেভ ব্যর্থ');
    } finally { setBusy(null); }
  }

  async function importConfig(file: File) {
    setBusy('import');
    try {
      const text = await file.text();
      const res = await fetch('/api/admin/telegram/config', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: text,
      });
      const d = await res.json();
      if (!res.ok) throw new Error(d.error || 'ইমপোর্ট ব্যর্থ');
      toast.success(d.message || 'ইমপোর্ট সম্পন্ন');
      setImportOpen(false);
      await refresh();
      router.refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'ইমপোর্ট ব্যর্থ');
    } finally { setBusy(null); }
  }

  // ── উইজার্ড মোড ──
  if (wizard) {
    return (
      <ConnectionWizard
        initialEvents={events}
        onClose={async () => { setWizard(false); await refresh(); router.refresh(); }}
      />
    );
  }

  const statusColor = c.connected ? 'var(--v-volt)'
    : c.unreachable || c.tokenValid ? 'var(--v-ice)' : 'var(--v-heat)';
  const statusText = c.connected ? 'সংযুক্ত'
    : !c.hasToken ? 'কনফিগার করা হয়নি'
    : c.unreachable ? 'টেলিগ্রামে পৌঁছানো যায়নি'
    : c.tokenValid ? 'আংশিক — Chat ID নেই'
    : 'টোকেন অবৈধ';

  return (
    <div className="space-y-5">
      {/* ═══ ট্যাব ═══ */}
      <div className="card p-2" role="tablist" aria-label="টেলিগ্রাম বিভাগ">
        <div className="flex flex-wrap gap-1">
          {TABS.map((t) => (
            <button
              key={t.id}
              role="tab"
              aria-selected={tab === t.id}
              onClick={() => setTab(t.id)}
              className="rounded-lg px-3 py-2 text-[12px] font-bold transition"
              style={{
                background: tab === t.id ? 'var(--v-volt)' : 'transparent',
                color: tab === t.id ? 'var(--v-void)' : 'var(--v-mut)',
              }}
            >
              {t.label}
            </button>
          ))}
        </div>
      </div>

      {tab === 'bots' && <div role="tabpanel"><BotsPanel /></div>}
      {tab === 'scheduler' && <div role="tabpanel"><SchedulerPanel /></div>}
      {tab === 'templates' && <div role="tabpanel"><TemplatesPanel /></div>}
      {tab === 'analytics' && <div role="tabpanel"><AnalyticsPanel /></div>}
      {tab === 'backup' && <div role="tabpanel"><BackupPanel /></div>}

      {tab !== 'overview' ? null : (
      <>
      {/* ═══ সংযোগ ═══ */}
      <div className="card p-4 sm:p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex min-w-0 items-center gap-3">
            {c.photoUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={c.photoUrl} alt={`${c.botName ?? 'বট'} প্রোফাইল ছবি`}
                className="h-11 w-11 shrink-0 rounded-full object-cover" />
            ) : (
              <span className="grid h-11 w-11 shrink-0 place-items-center rounded-full text-xl"
                style={{ background: 'var(--v-steel)' }}>🤖</span>
            )}
            <div className="min-w-0">
              <h2 className="truncate text-[15px] font-bold" style={{ color: 'var(--v-ink)' }}>
                {c.botName || 'টেলিগ্রাম বট'}
              </h2>
              {c.botUsername && (
                <a href={`https://t.me/${c.botUsername}`} target="_blank" rel="noopener noreferrer"
                  className="text-[12px] hover:underline" style={{ color: 'var(--v-ice)' }}>
                  @{c.botUsername}
                </a>
              )}
            </div>
          </div>
          <span className="rounded-full px-3 py-1 text-[11.5px] font-bold"
            style={{ background: 'var(--v-steel)', color: statusColor, border: `1px solid ${statusColor}` }}>
            ● {statusText}
          </span>
        </div>

        <div className="mt-3">
          <Row label="বট ID"><span className="font-mono">{c.botId ?? '—'}</span></Row>
          <Row label="বট টোকেন">
            {data.bots[0]?.hasToken ? (
              <span className="flex items-center gap-2">
                <span className="font-mono">{data.bots[0].tokenMasked}</span>
                <span className="rounded px-1.5 py-0.5 text-[10px] font-bold"
                  style={{ background: 'var(--tint-volt)', color: 'var(--v-ink)' }}>
                  🔒 এনক্রিপ্টেড
                </span>
              </span>
            ) : <span style={{ color: 'var(--v-heat)' }}>সেট করা নেই</span>}
          </Row>
          <Row label="Chat ID">
            {data.bots[0]?.hasChatId
              ? <span className="font-mono">{data.bots[0].chatIdMasked}</span>
              : <span style={{ color: 'var(--v-heat)' }}>সেট করা নেই</span>}
          </Row>
          <Row label="কনফিগের উৎস">
            <span className="rounded px-2 py-0.5 text-[11px] font-bold"
              style={{
                background: c.source === 'db' ? 'var(--tint-volt)' : 'var(--tint-ice)',
                color: 'var(--v-ink)',
              }}>
              {c.source === 'db' ? '🗄️ ডাটাবেস (এনক্রিপ্টেড)' : c.source === 'env' ? '📄 .env ফাইল' : '—'}
            </span>
          </Row>
          <Row label="শেষ সংযোগ পরীক্ষা">
            <span title={fullTime(s.lastCheckAt)}>{ago(s.lastCheckAt)}</span>
          </Row>
          <Row label="API লেটেন্সি">
            {s.lastLatencyMs !== null ? (
              <span className="tabular-nums"
                style={{ color: s.lastLatencyMs < 800 ? 'var(--v-volt)' : s.lastLatencyMs < 2500 ? 'var(--v-ice)' : 'var(--v-heat)' }}>
                {s.lastLatencyMs} ms
              </span>
            ) : '—'}
          </Row>
          <Row label="শেষ API রেসপন্স">
            <span className="font-mono text-[11.5px]">{s.lastApiResponse || '—'}</span>
          </Row>
        </div>

        {c.source === 'env' && (
          <div className="mt-3 rounded-lg p-3" style={{ background: 'var(--tint-ice)' }}>
            <p className="text-[11.5px] leading-relaxed" style={{ color: 'var(--v-ink)' }}>
              ⚠️ কনফিগ এখনো <code>.env</code> ফাইল থেকে আসছে। এক ক্লিকে এটি
              <strong> এনক্রিপ্ট হয়ে ডাটাবেসে</strong> চলে আসবে — তখন আর কোনো ফাইল সম্পাদনার
              দরকার থাকবে না (EXE বিতরণের জন্য এটাই দরকার)।
            </p>
            <button onClick={() => act('adopt-env', 'মাইগ্রেশন')}
              disabled={busy !== null || !data.storage.encryptionReady}
              className="btn-primary wz-cta mt-2 px-4 py-2 text-xs font-bold disabled:opacity-50">
              {busy === 'adopt-env' ? 'নেওয়া হচ্ছে…' : '🔐 ডাটাবেসে নিয়ে আসুন'}
            </button>
          </div>
        )}
        {!data.storage.encryptionReady && (
          <p className="mt-3 rounded-lg p-3 text-[11.5px] leading-relaxed"
            style={{ background: 'var(--tint-violet)', color: 'var(--v-heat)' }}>
            ✕ এনক্রিপশন কী নেই — সার্ভারে <code>NEXTAUTH_SECRET</code> সেট করুন, নাহলে টোকেন
            নিরাপদে সংরক্ষণ করা যাবে না।
          </p>
        )}
        {c.error && (
          <p className="mt-3 rounded-lg p-3 text-[11.5px] leading-relaxed"
            style={{ background: 'var(--tint-violet)', color: c.unreachable ? 'var(--v-ice)' : 'var(--v-heat)' }}>
            {c.unreachable ? '⏳ ' : '✕ '}{c.error}
            {c.unreachable && (
              <span className="block" style={{ color: 'var(--v-dim)' }}>
                এটি নেটওয়ার্ক সমস্যা — টোকেন ভুল বলে প্রমাণিত হয়নি।
              </span>
            )}
          </p>
        )}
      </div>

      {/* ═══ পরিসংখ্যান ═══ */}
      <div className="card p-4 sm:p-5">
        <h2 className="text-[15px] font-bold" style={{ color: 'var(--v-ink)' }}>বার্তা পরিসংখ্যান</h2>
        <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
          <Stat label="মোট পাঠানো" value={s.totalSent} tone="var(--v-volt)" />
          <Stat label="ব্যর্থ" value={s.totalFailed} tone={s.totalFailed > 0 ? 'var(--v-heat)' : undefined} />
          <Stat label="পুনঃচেষ্টা" value={s.totalRetries} />
          <Stat label="লেটেন্সি" value={s.lastLatencyMs !== null ? `${s.lastLatencyMs}ms` : '—'} />
        </div>
        <div className="mt-3">
          <Row label="শেষ সফল বার্তা">
            {s.lastOkAt ? (
              <span title={fullTime(s.lastOkAt)} style={{ color: 'var(--v-volt)' }}>
                {ago(s.lastOkAt)}
                {s.lastOkEvent && <span className="ml-1.5 text-[11px] font-normal" style={{ color: 'var(--v-dim)' }}>({s.lastOkEvent})</span>}
              </span>
            ) : <span style={{ color: 'var(--v-dim)' }}>এখনো কিছু পাঠানো হয়নি</span>}
          </Row>
          <Row label="শেষ ব্যর্থ বার্তা">
            {s.lastFailAt ? (
              <span title={fullTime(s.lastFailAt)} style={{ color: 'var(--v-heat)' }}>
                {s.lastFailError} <span className="text-[11px] font-normal" style={{ color: 'var(--v-dim)' }}>({ago(s.lastFailAt)})</span>
              </span>
            ) : <span style={{ color: 'var(--v-dim)' }}>কোনো ব্যর্থতা নেই</span>}
          </Row>
        </div>
      </div>

      {/* ═══ ব্যবস্থাপনা ═══ */}
      <div className="card p-4 sm:p-5">
        <h2 className="text-[15px] font-bold" style={{ color: 'var(--v-ink)' }}>ব্যবস্থাপনা</h2>
        <div className="mt-3 flex flex-wrap gap-2">
          <button onClick={() => setWizard(true)} className="btn-primary wz-cta px-4 py-2 text-xs font-bold">
            🧙 Connection Wizard
          </button>
          <button onClick={() => act('test', 'টেস্ট')} disabled={busy !== null || !c.hasToken}
            className="btn-ghost wz-cta px-4 py-2 text-xs font-bold disabled:opacity-50">
            {busy === 'test' ? 'পাঠানো হচ্ছে…' : '✈️ টেস্ট মেসেজ'}
          </button>
          <button onClick={() => act('reconnect', 'পুনঃসংযোগ')} disabled={busy !== null || !c.hasToken}
            className="btn-ghost wz-cta px-4 py-2 text-xs font-bold disabled:opacity-50">
            {busy === 'reconnect' ? 'সংযোগ হচ্ছে…' : '🔄 পুনঃসংযোগ'}
          </button>
          <button onClick={() => act(enabled ? 'disable' : 'enable', enabled ? 'বন্ধ' : 'চালু')}
            disabled={busy !== null}
            className="btn-ghost wz-cta px-4 py-2 text-xs font-bold disabled:opacity-50">
            {enabled ? '⏸️ বন্ধ করুন' : '▶️ চালু করুন'}
          </button>
          <button onClick={() => act('disconnect', 'বিচ্ছিন্ন')} disabled={busy !== null || !c.hasToken}
            className="btn-ghost wz-cta px-4 py-2 text-xs font-bold disabled:opacity-50">
            🔌 বিচ্ছিন্ন
          </button>
          <a href="/api/admin/telegram/config" download
            className="btn-ghost wz-cta px-4 py-2 text-xs font-bold">⬇️ এক্সপোর্ট</a>
          <button onClick={() => setImportOpen((v) => !v)} className="btn-ghost wz-cta px-4 py-2 text-xs font-bold">
            ⬆️ ইমপোর্ট
          </button>
          <button onClick={() => setConfirmReset(true)} disabled={busy !== null}
            className="btn-ghost wz-cta px-4 py-2 text-xs font-bold disabled:opacity-50"
            style={{ color: 'var(--v-heat)' }}>
            🗑️ রিসেট
          </button>
        </div>

        {importOpen && (
          <div className="wz-rise mt-3 rounded-lg p-3" style={{ background: 'var(--v-steel)' }}>
            <label className="label" htmlFor="tg-import">কনফিগ ফাইল (.json)</label>
            <input id="tg-import" type="file" accept="application/json,.json"
              className="input text-[12px]"
              onChange={(e) => { const f = e.target.files?.[0]; if (f) importConfig(f); }}
              disabled={busy !== null}
            />
            <p className="mt-1.5 text-[11px] leading-relaxed" style={{ color: 'var(--v-dim)' }}>
              🔒 এক্সপোর্ট ফাইলে <strong>বট টোকেন থাকে না</strong> — টোকেন এই ইনস্টলেশনের কী দিয়ে
              এনক্রিপ্টেড, তাই অন্য মেশিনে অর্থহীন; আর প্লেইনটেক্সট রপ্তানি করলে ফাইলটিই ফাঁস হতো।
              ইমপোর্টের পর টোকেন আবার বসাতে হবে।
            </p>
          </div>
        )}
      </div>

      {/* ═══ নোটিফিকেশন পছন্দ ═══ */}
      <div className="card p-4 sm:p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-[15px] font-bold" style={{ color: 'var(--v-ink)' }}>নোটিফিকেশন</h2>
            <p className="mt-0.5 text-[11.5px]" style={{ color: 'var(--v-mut)' }}>
              মাস্টার সুইচ বন্ধ থাকলে কোনো ইভেন্টই পাঠানো হবে না।
            </p>
          </div>
          <label className="flex cursor-pointer items-center gap-2">
            <input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)}
              className="h-4 w-4 cursor-pointer" aria-label="টেলিগ্রাম নোটিফিকেশন চালু" />
            <span className="text-[13px] font-bold"
              style={{ color: enabled ? 'var(--v-volt)' : 'var(--v-mut)' }}>
              {enabled ? 'চালু' : 'বন্ধ'}
            </span>
          </label>
        </div>

        <div className="mt-4 space-y-3" style={{ opacity: enabled ? 1 : 0.45 }}>
          {GROUP_ORDER.map((g) => {
            const items = events.filter((e) => e.group === g);
            if (!items.length) return null;
            return (
              <div key={g}>
                <p className="mb-1.5 text-[12px] font-bold" style={{ color: 'var(--v-mut)' }}>{GROUP_LABEL[g]}</p>
                <div className="grid gap-1.5 sm:grid-cols-2">
                  {items.map((ev) => (
                    <label key={ev.key} className="flex cursor-pointer items-start gap-2.5 rounded-lg p-2.5"
                      style={{ background: 'var(--v-steel)' }}>
                      <input type="checkbox" checked={ev.enabled} disabled={!enabled}
                        onChange={(e) => setEvents((xs) => xs.map((x) => x.key === ev.key ? { ...x, enabled: e.target.checked } : x))}
                        className="mt-0.5 h-4 w-4 cursor-pointer" aria-label={ev.label} />
                      <span className="min-w-0">
                        <span className="block text-[12.5px] font-semibold" style={{ color: 'var(--v-ink)' }}>
                          {ev.label}
                          {!ev.wired && (
                            <span className="ml-1.5 align-middle rounded px-1.5 py-0.5 text-[9.5px] font-bold"
                              style={{ background: 'var(--tint-ice)', color: 'var(--v-mut)' }}
                              title="এই ইভেন্টের জন্য একটি শিডিউলার দরকার, যা এখনো যুক্ত হয়নি">
                              শিডিউলার দরকার
                            </span>
                          )}
                        </span>
                        <span className="block text-[11px]" style={{ color: 'var(--v-dim)' }}>{ev.hint}</span>
                      </span>
                    </label>
                  ))}
                </div>
              </div>
            );
          })}
        </div>

        <div className="mt-4 flex items-center gap-3">
          <button onClick={savePrefs} disabled={busy !== null || !dirty}
            className="btn-primary wz-cta px-5 py-2 text-xs font-bold disabled:opacity-50">
            {busy === 'prefs' ? 'সেভ হচ্ছে…' : 'সেভ করুন'}
          </button>
          {dirty && <span className="text-[11.5px]" style={{ color: 'var(--v-mut)' }}>অসংরক্ষিত পরিবর্তন আছে</span>}
        </div>
      </div>
      </>
      )}

      <ConfirmDialog
        open={confirmReset}
        title="সব টেলিগ্রাম কনফিগ মুছে ফেলবেন?"
        message="বট টোকেন, Chat ID, ইভেন্ট পছন্দ ও পরিসংখ্যান — সবই মুছে যাবে। এটি ফেরানো যাবে না।"
        confirmLabel="হ্যাঁ, রিসেট করুন"
        onCancel={() => setConfirmReset(false)}
        onConfirm={async () => { setConfirmReset(false); await act('reset', 'রিসেট'); }}
      />
    </div>
  );
}
