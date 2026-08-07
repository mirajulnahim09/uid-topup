'use client';

import { useEffect, useState, useCallback } from 'react';
import { useToast, ConfirmDialog } from '@/components/Toast';

/**
 * ★★★ বহু-বট ব্যবস্থাপনা।
 *
 *   ⚠️ টোকেন কখনো সার্ভার থেকে ফেরত আসে না — তালিকায় শুধু `tokenMasked`।
 *   সম্পাদনার সময় টোকেন ঘর **ফাঁকা** থাকে; ফাঁকা রাখলে আগের টোকেন
 *   অপরিবর্তিত থাকে (ফাঁকা = "মুছে ফেলো" নয়, নাহলে একবার সেভ করলেই
 *   সংযোগ ভেঙে যেত)।
 */

type Stats = {
  sent: number; failed: number; successRate: number; avgLatencyMs: number;
  lastOkAt: string | null; lastError: string | null; lastErrorAt: string | null;
} | null;

type Bot = {
  id: string; role: string; label: string; description: string | null;
  enabled: boolean; priority: number; events: string[];
  tokenMasked: string; chatIdMasked: string; hasToken: boolean; hasChatId: boolean;
  username: string | null; name: string | null; botId: number | null;
  photoUrl: string | null; source: 'db' | 'env'; stats: Stats;
};
type RoleInfo = { id: string; label: string; defaultEvents: string[] };
type EventInfo = { key: string; label: string; group: string };

const GROUP_LABEL: Record<string, string> = {
  money: '💰 টাকা', order: '📦 অর্ডার', user: '👤 ইউজার',
  system: '⚙️ সিস্টেম', digest: '📊 সারসংক্ষেপ',
};

const ago = (iso: string | null) => {
  if (!iso) return '—';
  const s = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (Number.isNaN(s)) return '—';
  if (s < 60) return 'এইমাত্র';
  if (s < 3600) return `${Math.floor(s / 60)} মি আগে`;
  if (s < 86400) return `${Math.floor(s / 3600)} ঘ আগে`;
  return `${Math.floor(s / 86400)} দিন আগে`;
};

type Draft = {
  id?: string; role: string; label: string; description: string;
  token: string; chatId: string; enabled: boolean; events: string[];
};

export default function BotsPanel() {
  const toast = useToast();
  const [bots, setBots] = useState<Bot[]>([]);
  const [roles, setRoles] = useState<RoleInfo[]>([]);
  const [events, setEvents] = useState<EventInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [confirmDel, setConfirmDel] = useState<Bot | null>(null);
  const [dragId, setDragId] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const r = await fetch('/api/admin/telegram/bots');
      if (!r.ok) throw new Error('লোড ব্যর্থ');
      const d = await r.json();
      setBots(d.bots ?? []);
      setRoles(d.roles ?? []);
      setEvents(d.events ?? []);
    } catch { toast.error('বট তালিকা আনা যায়নি'); }
    finally { setLoading(false); }
  }, [toast]);

  useEffect(() => { void load(); }, [load]);

  async function act(payload: Record<string, unknown>, label: string, tag: string) {
    setBusy(tag);
    try {
      const r = await fetch('/api/admin/telegram/bots', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || `${label} ব্যর্থ`);
      toast.success(d.message || `${label} সফল`);
      await load();
      return true;
    } catch (e) {
      toast.error(e instanceof Error ? e.message : `${label} ব্যর্থ`);
      return false;
    } finally { setBusy(null); }
  }

  function newBot() {
    const role = roles[0]?.id ?? 'admin';
    setDraft({
      id: undefined, role, label: '', description: '',
      token: '', chatId: '', enabled: true,
      events: roles.find((r) => r.id === role)?.defaultEvents ?? [],
    });
  }

  function editBot(b: Bot) {
    setDraft({
      id: b.id, role: b.role, label: b.label, description: b.description ?? '',
      token: '', // ★ কখনো পূর্বপূরণ নয় — টোকেন ব্রাউজারে আসেই না
      chatId: '', enabled: b.enabled,
      events: b.events.length ? b.events : (roles.find((r) => r.id === b.role)?.defaultEvents ?? []),
    });
  }

  async function saveDraft() {
    if (!draft) return;
    if (!draft.label.trim()) { toast.error('বটের নাম দিন'); return; }
    if (!draft.id && !draft.token.trim()) { toast.error('নতুন বটে টোকেন দিতে হবে'); return; }
    const ok = await act({
      action: 'save', id: draft.id, role: draft.role,
      label: draft.label, description: draft.description,
      ...(draft.token.trim() ? { token: draft.token.trim() } : {}),
      ...(draft.chatId.trim() ? { chatId: draft.chatId.trim() } : {}),
      enabled: draft.enabled, events: draft.events,
    }, 'সংরক্ষণ', 'save');
    if (ok) setDraft(null);
  }

  // ── drag-and-drop অগ্রাধিকার ──
  async function onDrop(targetId: string) {
    if (!dragId || dragId === targetId) { setDragId(null); return; }
    const ids = bots.map((b) => b.id);
    const from = ids.indexOf(dragId);
    const to = ids.indexOf(targetId);
    if (from < 0 || to < 0) { setDragId(null); return; }
    ids.splice(to, 0, ...ids.splice(from, 1));
    setDragId(null);
    // আশাবাদী রি-অর্ডার, তারপর সার্ভারে
    setBots((xs) => ids.map((id) => xs.find((b) => b.id === id)!).filter(Boolean));
    await act({ action: 'reorder', order: ids }, 'অগ্রাধিকার', 'reorder');
  }

  if (loading) return <div className="card p-5 text-[13px]" style={{ color: 'var(--v-mut)' }}>লোড হচ্ছে…</div>;

  const grouped = ['money', 'order', 'user', 'system', 'digest']
    .map((g) => ({ g, items: events.filter((e) => e.group === g) }))
    .filter((x) => x.items.length);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-[12px]" style={{ color: 'var(--v-mut)' }}>
          একই ইভেন্ট একাধিক বটে যেতে পারে। কার্ড টেনে (drag) অগ্রাধিকার বদলান — উপরের বট আগে পায়।
        </p>
        <button onClick={newBot} className="btn-primary wz-cta px-4 py-2 text-xs font-bold">
          ＋ নতুন বট
        </button>
      </div>

      {bots.length === 0 && (
        <div className="card p-5 text-center text-[13px]" style={{ color: 'var(--v-mut)' }}>
          কোনো বট নেই — &ldquo;নতুন বট&rdquo; দিয়ে শুরু করুন।
        </div>
      )}

      <div className="space-y-2">
        {bots.map((b, i) => (
          <div
            key={b.id}
            draggable
            onDragStart={() => setDragId(b.id)}
            onDragOver={(e) => e.preventDefault()}
            onDrop={() => onDrop(b.id)}
            className="card wz-rise p-3.5 sm:p-4"
            style={{ opacity: dragId === b.id ? 0.5 : 1, cursor: 'grab' }}
          >
            <div className="flex flex-wrap items-start gap-3">
              <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full text-[11px] font-bold"
                style={{ background: 'var(--v-steel)', color: 'var(--v-mut)' }}
                title="অগ্রাধিকার ক্রম">
                #{i + 1}
              </span>
              {b.photoUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={b.photoUrl} alt="" className="h-10 w-10 shrink-0 rounded-full object-cover" />
              ) : (
                <span className="grid h-10 w-10 shrink-0 place-items-center rounded-full text-lg"
                  style={{ background: 'var(--v-steel)' }}>🤖</span>
              )}

              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-[14px] font-bold" style={{ color: 'var(--v-ink)' }}>{b.label}</span>
                  <span className="rounded px-1.5 py-0.5 text-[10px] font-bold"
                    style={{ background: 'var(--v-steel)', color: 'var(--v-mut)' }}>
                    {roles.find((r) => r.id === b.role)?.label ?? b.role}
                  </span>
                  <span className="rounded-full px-2 py-0.5 text-[10px] font-bold"
                    style={{
                      background: b.enabled ? 'var(--tint-volt)' : 'var(--tint-violet)',
                      color: 'var(--v-ink)',
                    }}>
                    ● {b.enabled ? 'সক্রিয়' : 'নিষ্ক্রিয়'}
                  </span>
                  {b.source === 'env' && (
                    <span className="rounded px-1.5 py-0.5 text-[10px]" style={{ background: 'var(--tint-ice)', color: 'var(--v-ink)' }}>.env</span>
                  )}
                </div>
                {b.description && (
                  <p className="mt-0.5 text-[11.5px]" style={{ color: 'var(--v-dim)' }}>{b.description}</p>
                )}
                <div className="mt-1 flex flex-wrap gap-x-4 gap-y-0.5 text-[11px]" style={{ color: 'var(--v-mut)' }}>
                  {b.username && <span>@{b.username}</span>}
                  {b.botId && <span className="font-mono">ID {b.botId}</span>}
                  <span className="font-mono">টোকেন {b.hasToken ? b.tokenMasked : '—'}</span>
                  <span className="font-mono">চ্যাট {b.hasChatId ? b.chatIdMasked : '—'}</span>
                  <span>{b.events.length} ইভেন্ট</span>
                </div>
                {b.stats && (
                  <div className="mt-1.5 flex flex-wrap gap-x-4 gap-y-0.5 text-[11px]">
                    <span style={{ color: 'var(--v-mut)' }}>পাঠানো <b style={{ color: 'var(--v-ink)' }}>{b.stats.sent}</b></span>
                    <span style={{ color: 'var(--v-mut)' }}>ব্যর্থ <b style={{ color: b.stats.failed ? 'var(--v-heat)' : 'var(--v-ink)' }}>{b.stats.failed}</b></span>
                    <span style={{ color: 'var(--v-mut)' }}>সাফল্য <b style={{ color: 'var(--v-volt)' }}>{b.stats.successRate}%</b></span>
                    <span style={{ color: 'var(--v-mut)' }}>গড় <b style={{ color: 'var(--v-ink)' }}>{b.stats.avgLatencyMs}ms</b></span>
                    <span style={{ color: 'var(--v-mut)' }}>শেষ সফল <b style={{ color: 'var(--v-ink)' }}>{ago(b.stats.lastOkAt)}</b></span>
                    {b.stats.lastError && (
                      <span style={{ color: 'var(--v-heat)' }} title={b.stats.lastError}>
                        শেষ ত্রুটি: {b.stats.lastError.slice(0, 40)}
                      </span>
                    )}
                  </div>
                )}
              </div>
            </div>

            <div className="mt-3 flex flex-wrap gap-1.5">
              <button onClick={() => editBot(b)} className="btn-ghost px-3 py-1.5 text-[11px] font-bold">✏️ সম্পাদনা</button>
              <button onClick={() => act({ action: 'test', id: b.id }, 'টেস্ট', `test-${b.id}`)}
                disabled={busy !== null || !b.hasToken || !b.hasChatId}
                className="btn-ghost px-3 py-1.5 text-[11px] font-bold disabled:opacity-40">
                {busy === `test-${b.id}` ? '…' : '✈️ টেস্ট'}
              </button>
              <button onClick={() => act({ action: b.enabled ? 'disable' : 'enable', id: b.id }, b.enabled ? 'নিষ্ক্রিয়' : 'সক্রিয়', `t-${b.id}`)}
                disabled={busy !== null}
                className="btn-ghost px-3 py-1.5 text-[11px] font-bold disabled:opacity-40">
                {b.enabled ? '⏸️ নিষ্ক্রিয়' : '▶️ সক্রিয়'}
              </button>
              <button onClick={() => act({ action: 'duplicate', id: b.id }, 'নকল', `d-${b.id}`)}
                disabled={busy !== null}
                className="btn-ghost px-3 py-1.5 text-[11px] font-bold disabled:opacity-40">
                ⧉ নকল
              </button>
              <button onClick={() => setConfirmDel(b)} disabled={busy !== null}
                className="btn-ghost px-3 py-1.5 text-[11px] font-bold disabled:opacity-40"
                style={{ color: 'var(--v-heat)' }}>
                🗑️ মুছুন
              </button>
            </div>
          </div>
        ))}
      </div>

      {/* ═══ সম্পাদনা ফর্ম ═══ */}
      {draft && (
        <div className="card wz-rise space-y-3 p-4 sm:p-5">
          <h3 className="text-[14px] font-bold" style={{ color: 'var(--v-ink)' }}>
            {draft.id ? 'বট সম্পাদনা' : 'নতুন বট'}
          </h3>

          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <label className="label" htmlFor="bp-name">নাম</label>
              <input id="bp-name" className="input" value={draft.label}
                onChange={(e) => setDraft({ ...draft, label: e.target.value })}
                placeholder="যেমন: অ্যাডমিন অ্যালার্ট বট" />
            </div>
            <div>
              <label className="label" htmlFor="bp-role">ভূমিকা (Role)</label>
              <select id="bp-role" className="input" value={draft.role}
                onChange={(e) => {
                  const role = e.target.value;
                  setDraft({ ...draft, role, events: roles.find((r) => r.id === role)?.defaultEvents ?? [] });
                }}>
                {roles.map((r) => <option key={r.id} value={r.id}>{r.label}</option>)}
              </select>
            </div>
            <div className="sm:col-span-2">
              <label className="label" htmlFor="bp-desc">বিবরণ (ঐচ্ছিক)</label>
              <input id="bp-desc" className="input" value={draft.description}
                onChange={(e) => setDraft({ ...draft, description: e.target.value })}
                placeholder="এই বট কী কাজে ব্যবহার হয়" />
            </div>
            <div>
              <label className="label" htmlFor="bp-token">
                বট টোকেন {draft.id && <span style={{ color: 'var(--v-dim)' }}>(খালি = অপরিবর্তিত)</span>}
              </label>
              <input id="bp-token" className="input font-mono text-[12px]" value={draft.token}
                autoComplete="off" spellCheck={false}
                onChange={(e) => setDraft({ ...draft, token: e.target.value.trim() })}
                onPaste={(e) => {
                  e.preventDefault();
                  setDraft({ ...draft, token: e.clipboardData.getData('text').trim().replace(/[\r\n\t]/g, '') });
                }}
                placeholder="123456789:AAH…" />
            </div>
            <div>
              <label className="label" htmlFor="bp-chat">
                Chat ID {draft.id && <span style={{ color: 'var(--v-dim)' }}>(খালি = অপরিবর্তিত)</span>}
              </label>
              <input id="bp-chat" className="input font-mono text-[12px]" value={draft.chatId}
                autoComplete="off" spellCheck={false}
                onChange={(e) => setDraft({ ...draft, chatId: e.target.value.trim() })}
                placeholder="-1001234567890" />
            </div>
          </div>

          <div>
            <p className="mb-1.5 text-[12px] font-bold" style={{ color: 'var(--v-ink)' }}>
              এই বট কোন ইভেন্ট পাবে ({draft.events.length}টি নির্বাচিত)
            </p>
            {grouped.map(({ g, items }) => (
              <div key={g} className="mb-2">
                <p className="mb-1 text-[11px] font-bold" style={{ color: 'var(--v-mut)' }}>{GROUP_LABEL[g]}</p>
                <div className="flex flex-wrap gap-1.5">
                  {items.map((ev) => {
                    const on = draft.events.includes(ev.key);
                    return (
                      <button key={ev.key} type="button"
                        onClick={() => setDraft({
                          ...draft,
                          events: on ? draft.events.filter((k) => k !== ev.key) : [...draft.events, ev.key],
                        })}
                        aria-pressed={on}
                        className="rounded-full px-2.5 py-1 text-[11px] font-semibold transition"
                        style={{
                          background: on ? 'var(--v-volt)' : 'var(--v-steel)',
                          color: on ? 'var(--v-void)' : 'var(--v-mut)',
                        }}>
                        {on ? '✓ ' : ''}{ev.label}
                      </button>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>

          <label className="flex cursor-pointer items-center gap-2">
            <input type="checkbox" checked={draft.enabled} className="h-4 w-4 cursor-pointer"
              onChange={(e) => setDraft({ ...draft, enabled: e.target.checked })} />
            <span className="text-[12.5px] font-semibold" style={{ color: 'var(--v-ink)' }}>সক্রিয়</span>
          </label>

          <div className="flex flex-wrap gap-2">
            <button onClick={() => setDraft(null)} className="btn-ghost px-4 py-2 text-xs font-bold">বাতিল</button>
            <button onClick={saveDraft} disabled={busy !== null}
              className="btn-primary wz-cta ml-auto px-5 py-2 text-xs font-bold disabled:opacity-50">
              {busy === 'save' ? 'সেভ হচ্ছে…' : 'সংরক্ষণ'}
            </button>
          </div>
        </div>
      )}

      <ConfirmDialog
        open={confirmDel !== null}
        title={`"${confirmDel?.label ?? ''}" মুছে ফেলবেন?`}
        message="এই বটের কনফিগ ও টোকেন মুছে যাবে। ডেলিভারি লগ থেকে যাবে। এটি ফেরানো যাবে না।"
        confirmLabel="হ্যাঁ, মুছুন"
        onCancel={() => setConfirmDel(null)}
        onConfirm={async () => {
          const id = confirmDel?.id; setConfirmDel(null);
          if (id) await act({ action: 'delete', id }, 'মুছে ফেলা', `del-${id}`);
        }}
      />
    </div>
  );
}
