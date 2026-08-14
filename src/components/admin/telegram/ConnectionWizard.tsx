'use client';

import { useState, useCallback, useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';

/**
 * ★★★ টেলিগ্রাম Connection Wizard — ৬ ধাপ
 *
 *   ⚠️ টোকেন এই কম্পোনেন্টে **থাকে** (অ্যাডমিন নিজে টাইপ করছে) কিন্তু
 *   কেবল ধাপ ২–৪ চলাকালীন, মেমরিতে। সেভ হওয়ার পর `setToken('')` দিয়ে
 *   মুছে ফেলা হয়, এবং সার্ভার কখনো এটি ফেরত পাঠায় না। অর্থাৎ পাতা
 *   রিফ্রেশ করলে টোকেন আর ব্রাউজারে নেই।
 */

export type WizardEvent = {
  key: string; group: string; label: string; hint: string; wired: boolean; enabled: boolean;
};

type BotInfo = {
  id: number; username: string; name: string;
  canJoinGroups?: boolean; photoUrl?: string | null;
};
type ChatInfo = { id: string; type: string; typeLabel: string; title: string; username: string | null };

const STEPS = ['শুরু', 'বট টোকেন', 'Chat ID', 'সংযোগ পরীক্ষা', 'নোটিফিকেশন', 'সম্পন্ন'];

const GROUP_ORDER = ['money', 'order', 'user', 'system', 'digest'];
const GROUP_LABEL: Record<string, string> = {
  money: '💰 টাকা', order: '📦 অর্ডার', user: '👤 ইউজার',
  system: '⚙️ সিস্টেম', digest: '📊 সারসংক্ষেপ',
};

function Orbit() {
  return <span className="wz-orbit" aria-hidden />;
}

export default function ConnectionWizard({
  initialEvents,
  onClose,
  startStep = 0,
}: {
  initialEvents: WizardEvent[];
  onClose?: () => void;
  startStep?: number;
}) {
  const router = useRouter();
  const [step, setStep] = useState(startStep);
  const [dir, setDir] = useState<'fwd' | 'back'>('fwd');

  const [token, setToken] = useState('');
  const [bot, setBot] = useState<BotInfo | null>(null);
  const [chatId, setChatId] = useState('');
  const [chat, setChat] = useState<ChatInfo | null>(null);

  const [events, setEvents] = useState<WizardEvent[]>(initialEvents);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [errorKind, setErrorKind] = useState<'format' | 'network' | 'rejected' | null>(null);
  const [testResult, setTestResult] = useState<{
    deliveredAt: string; responseMs: number; totalMs: number; attempts: number; apiStatus: string;
  } | null>(null);

  const liveRef = useRef<HTMLDivElement>(null);

  const go = useCallback((next: number) => {
    setDir(next > step ? 'fwd' : 'back');
    setError(null);
    setErrorKind(null);
    setStep(next);
  }, [step]);

  // ★ ধাপ বদলালে স্ক্রিন-রিডার যেন জানে (a11y)
  useEffect(() => {
    if (liveRef.current) liveRef.current.textContent = `ধাপ ${step + 1}: ${STEPS[step]}`;
  }, [step]);

  async function post<T>(url: string, body: unknown): Promise<T> {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const d = (await res.json()) as T & { error?: string };
    if (!res.ok) throw new Error(d.error || 'অনুরোধ ব্যর্থ');
    return d;
  }

  // ── ধাপ ২: টোকেন যাচাই ──
  async function verifyToken() {
    setBusy(true); setError(null); setErrorKind(null);
    try {
      const d = await post<{ ok: boolean; bot?: BotInfo; error?: string; stage?: string }>(
        '/api/admin/telegram/verify', { kind: 'token', token },
      );
      if (!d.ok || !d.bot) {
        setError(d.error || 'যাচাই ব্যর্থ');
        setErrorKind((d.stage as 'format' | 'network' | 'rejected') || 'rejected');
        setBot(null);
        return;
      }
      setBot(d.bot);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'যাচাই ব্যর্থ');
      setErrorKind('network');
    } finally { setBusy(false); }
  }

  // ── ধাপ ৩: চ্যাট যাচাই ──
  async function verifyChat() {
    setBusy(true); setError(null);
    try {
      const d = await post<{ ok: boolean; chat?: ChatInfo; error?: string }>(
        '/api/admin/telegram/verify', { kind: 'chat', token, chatId },
      );
      if (!d.ok || !d.chat) { setError(d.error || 'চ্যাট যাচাই ব্যর্থ'); setChat(null); return; }
      setChat(d.chat);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'চ্যাট যাচাই ব্যর্থ');
    } finally { setBusy(false); }
  }

  // ── ধাপ ৪: সেভ + টেস্ট ──
  //    সেভ আগে, কারণ টেস্ট সার্ভার-সাইড কনফিগ ব্যবহার করে — এতেই
  //    প্রমাণ হয় যে সংরক্ষিত কনফিগ সত্যিই কাজ করে, শুধু টাইপ করা
  //    মানগুলো নয়।
  async function saveAndTest() {
    setBusy(true); setError(null); setTestResult(null);
    try {
      await post('/api/admin/telegram/connect', { role: 'admin', token, chatId });
      // ★ সেভ হয়ে গেছে — টোকেন আর ব্রাউজারে রাখার দরকার নেই
      setToken('');
      const d = await post<{
        deliveredAt: string; responseMs: number; totalMs: number; attempts: number; apiStatus: string;
      }>('/api/admin/telegram/manage', { action: 'test' });
      setTestResult(d);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'টেস্ট ব্যর্থ');
    } finally { setBusy(false); }
  }

  // ── ধাপ ৫: পছন্দ সংরক্ষণ ──
  async function savePrefs() {
    setBusy(true); setError(null);
    try {
      await post('/api/admin/telegram', {
        enabled: true,
        events: Object.fromEntries(events.map((e) => [e.key, e.enabled])),
      });
      go(5);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'সেভ ব্যর্থ');
    } finally { setBusy(false); }
  }

  const canNext =
    step === 0 ? true :
    step === 1 ? Boolean(bot) :
    step === 2 ? Boolean(chat) :
    step === 3 ? Boolean(testResult) :
    true;

  return (
    /* ★ `wz-stage` — ধাপ বদলের স্লাইড-ইন যেন পাতাকে অনুভূমিকভাবে
       স্ক্রলযোগ্য করে না ফেলে (কারণ globals.css এ ব্যাখ্যা করা) */
    <div className="wz-stage space-y-4">
      <div ref={liveRef} className="sr-only" role="status" aria-live="polite" />

      {/* ═══ প্রগ্রেস ═══ */}
      <div className="card p-3 sm:p-4">
        <div className="flex items-center justify-between gap-1 sm:gap-2">
          {STEPS.map((label, i) => {
            const state = i === step ? 'active' : i < step ? 'done' : 'todo';
            return (
              <div key={label} className="flex min-w-0 flex-1 items-center gap-1 sm:gap-2">
                <span
                  className="wz-dot grid h-6 w-6 shrink-0 place-items-center rounded-full text-[10.5px] font-bold sm:h-7 sm:w-7 sm:text-[11.5px]"
                  data-state={state}
                  style={{
                    background: state === 'todo' ? 'var(--v-steel)' : 'var(--v-volt)',
                    color: state === 'todo' ? 'var(--v-dim)' : 'var(--v-void)',
                  }}
                  aria-current={state === 'active' ? 'step' : undefined}
                >
                  {state === 'done' ? '✓' : i + 1}
                </span>
                <span
                  className="hidden truncate text-[11.5px] font-semibold md:inline"
                  style={{ color: state === 'active' ? 'var(--v-ink)' : 'var(--v-dim)' }}
                >
                  {label}
                </span>
                {i < STEPS.length - 1 && (
                  <span
                    className="h-[2px] min-w-2 flex-1 rounded"
                    style={{ background: i < step ? 'var(--v-volt)' : 'var(--v-edge)' }}
                  />
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* ═══ ধাপের বিষয়বস্তু ═══ */}
      <div className="card wz-step p-4 sm:p-6" data-dir={dir} key={step}>

        {/* ───── ধাপ ১: স্বাগতম ───── */}
        {step === 0 && (
          <div className="space-y-4">
            <div className="flex items-center gap-3">
              <span className="grid h-12 w-12 shrink-0 place-items-center rounded-2xl text-2xl"
                style={{ background: 'var(--tint-ice)' }}>✈️</span>
              <div className="min-w-0">
                <h2 className="text-lg font-bold" style={{ color: 'var(--v-ink)' }}>
                  টেলিগ্রাম সংযোগ সহায়িকা
                </h2>
                <p className="text-[12.5px]" style={{ color: 'var(--v-mut)' }}>
                  আনুমানিক সময়: <strong>~২ মিনিট</strong>
                </p>
              </div>
            </div>

            <div className="rounded-xl p-3.5" style={{ background: 'var(--v-steel)' }}>
              <p className="text-[13px] font-bold" style={{ color: 'var(--v-ink)' }}>এটি কী করে</p>
              <p className="mt-1 text-[12.5px] leading-relaxed" style={{ color: 'var(--v-mut)' }}>
                নতুন অর্ডার, রিচার্জ, রিফান্ড ও স্টক-সতর্কতা সরাসরি আপনার টেলিগ্রামে পৌঁছে দেয় —
                অ্যাডমিন প্যানেল খোলা না রাখলেও ফোনে সাথে সাথে জানতে পারবেন।
              </p>
            </div>

            <div className="rounded-xl p-3.5" style={{ background: 'var(--v-steel)' }}>
              <p className="text-[13px] font-bold" style={{ color: 'var(--v-ink)' }}>যা যা লাগবে</p>
              <ol className="mt-1.5 space-y-1.5 text-[12.5px] leading-relaxed" style={{ color: 'var(--v-mut)' }}>
                <li>১. <strong>বট টোকেন</strong> — টেলিগ্রামে <code>@BotFather</code> → <code>/newbot</code></li>
                <li>২. <strong>Chat ID</strong> — যে চ্যাট/গ্রুপে বার্তা যাবে</li>
              </ol>
            </div>

            <p className="rounded-xl p-3 text-[11.5px] leading-relaxed"
              style={{ background: 'var(--tint-volt)', color: 'var(--v-ink)' }}>
              🔒 টোকেন <strong>এনক্রিপ্ট করে</strong> ডাটাবেসে রাখা হয় — কোনো ফাইল সম্পাদনা করতে হবে না,
              আর টোকেন কখনো এই পাতায় ফেরত দেখানো হবে না।
            </p>

            <button onClick={() => go(1)} className="btn-primary wz-cta w-full px-5 py-3 text-sm font-bold">
              শুরু করুন →
            </button>
          </div>
        )}

        {/* ───── ধাপ ২: টোকেন ───── */}
        {step === 1 && (
          <div className="space-y-4">
            <h2 className="text-lg font-bold" style={{ color: 'var(--v-ink)' }}>বট টোকেন</h2>
            <p className="text-[12.5px] leading-relaxed" style={{ color: 'var(--v-mut)' }}>
              টেলিগ্রামে <code>@BotFather</code> খুলে <code>/newbot</code> পাঠান, নাম ও username দিন —
              BotFather একটি টোকেন দেবে। পুরোটা কপি করে নিচে বসান।
            </p>

            <div>
              <label className="label" htmlFor="wz-token">Bot Token</label>
              <input
                id="wz-token"
                className={`input font-mono text-[12.5px] ${error && errorKind === 'format' ? 'wz-error' : ''}`}
                value={token}
                onChange={(e) => { setToken(e.target.value.trim()); setBot(null); setError(null); }}
                onPaste={(e) => {
                  // ★ পেস্টেই trim — কপি করার সময় সামনে/পেছনে ফাঁকা
                  //   জায়গা বা newline আসা সবচেয়ে সাধারণ ভুল।
                  e.preventDefault();
                  const t = e.clipboardData.getData('text').trim().replace(/[\r\n\t]/g, '');
                  setToken(t); setBot(null); setError(null);
                }}
                placeholder="123456789:AAH…"
                autoComplete="off"
                spellCheck={false}
                aria-invalid={Boolean(error)}
              />
              <p className="mt-1 text-[11px]" style={{ color: 'var(--v-dim)' }}>
                পেস্ট করলে বাড়তি ফাঁকা জায়গা ও newline নিজে থেকেই বাদ যায়।
              </p>
            </div>

            {error && (
              <p className="wz-error rounded-lg p-3 text-[12px] leading-relaxed"
                style={{
                  background: 'var(--tint-violet)',
                  color: errorKind === 'network' ? 'var(--v-ice)' : 'var(--v-heat)',
                }}>
                {errorKind === 'network' ? '⏳ ' : '✕ '}{error}
              </p>
            )}

            {bot && (
              <div className="wz-success rounded-xl p-3.5" style={{ background: 'var(--tint-volt)' }}>
                <div className="flex items-center gap-3">
                  {bot.photoUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={bot.photoUrl} alt={`${bot.name} প্রোফাইল ছবি`}
                      className="h-12 w-12 shrink-0 rounded-full object-cover" />
                  ) : (
                    <span className="grid h-12 w-12 shrink-0 place-items-center rounded-full text-xl"
                      style={{ background: 'var(--v-steel)' }}>🤖</span>
                  )}
                  <div className="min-w-0">
                    <p className="truncate text-[14px] font-bold" style={{ color: 'var(--v-ink)' }}>{bot.name}</p>
                    <p className="truncate text-[12px]" style={{ color: 'var(--v-mut)' }}>@{bot.username}</p>
                    <p className="font-mono text-[11px]" style={{ color: 'var(--v-dim)' }}>ID: {bot.id}</p>
                  </div>
                  <span className="ml-auto shrink-0 rounded-full px-2.5 py-1 text-[10.5px] font-bold"
                    style={{ background: 'var(--v-volt)', color: 'var(--v-void)' }}>✓ সংযুক্ত</span>
                </div>
              </div>
            )}

            <div className="flex flex-wrap gap-2">
              <button onClick={() => go(0)} className="btn-ghost px-4 py-2.5 text-sm font-bold">← পিছনে</button>
              <button onClick={verifyToken} disabled={busy || !token}
                className="btn-ghost wz-cta px-4 py-2.5 text-sm font-bold disabled:opacity-50">
                {busy ? <><Orbit /> যাচাই হচ্ছে…</> : 'টোকেন যাচাই করুন'}
              </button>
              <button onClick={() => go(2)} disabled={!canNext}
                className="btn-primary wz-cta ml-auto px-5 py-2.5 text-sm font-bold disabled:opacity-40">
                পরবর্তী →
              </button>
            </div>
            {!bot && (
              <p className="text-[11px]" style={{ color: 'var(--v-dim)' }}>
                যাচাই সফল না হওয়া পর্যন্ত পরের ধাপে যাওয়া যাবে না।
              </p>
            )}
          </div>
        )}

        {/* ───── ধাপ ৩: Chat ID ───── */}
        {step === 2 && (
          <div className="space-y-4">
            <h2 className="text-lg font-bold" style={{ color: 'var(--v-ink)' }}>Chat ID</h2>
            <p className="text-[12.5px] leading-relaxed" style={{ color: 'var(--v-mut)' }}>
              বার্তাগুলো কোথায় যাবে? ব্যক্তিগত চ্যাট, গ্রুপ, সুপারগ্রুপ বা চ্যানেল — সবই চলবে।
            </p>

            <div className="grid gap-2 sm:grid-cols-2">
              {[
                { t: '👤 ব্যক্তিগত চ্যাট', d: <>টেলিগ্রামে <strong>@{bot?.username ?? 'আপনার বট'}</strong> খুঁজে <code>/start</code> পাঠান।</> },
                { t: '👥 গ্রুপ / সুপারগ্রুপ', d: <>গ্রুপ বানিয়ে বটকে <strong>সদস্য</strong> হিসেবে যোগ করুন, একটি মেসেজ দিন।</> },
                { t: '📢 চ্যানেল', d: <>বটকে চ্যানেলের <strong>অ্যাডমিন</strong> করুন (পোস্ট করার অনুমতি সহ)।</> },
                { t: '🔎 ID বের করা', d: <>সার্ভারে চালান: <code>npx tsx scripts/telegram-check.ts</code> — ID দেখিয়ে দেবে।</> },
              ].map((x) => (
                <div key={x.t} className="wz-rise rounded-xl p-3" style={{ background: 'var(--v-steel)' }}>
                  <p className="text-[12.5px] font-bold" style={{ color: 'var(--v-ink)' }}>{x.t}</p>
                  <p className="mt-0.5 text-[11.5px] leading-relaxed" style={{ color: 'var(--v-mut)' }}>{x.d}</p>
                </div>
              ))}
            </div>

            <div>
              <label className="label" htmlFor="wz-chat">Chat ID</label>
              <input
                id="wz-chat"
                className={`input font-mono text-[12.5px] ${error ? 'wz-error' : ''}`}
                value={chatId}
                onChange={(e) => { setChatId(e.target.value.trim()); setChat(null); setError(null); }}
                placeholder="1917673949  বা  -1001234567890"
                autoComplete="off"
                spellCheck={false}
              />
              <p className="mt-1 text-[11px]" style={{ color: 'var(--v-dim)' }}>
                গ্রুপ ও চ্যানেলের ID ঋণাত্মক হয় (যেমন <code>-100…</code>)।
              </p>
            </div>

            {error && (
              <p className="wz-error rounded-lg p-3 text-[12px] leading-relaxed"
                style={{ background: 'var(--tint-violet)', color: 'var(--v-heat)' }}>✕ {error}</p>
            )}

            {chat && (
              <div className="wz-success rounded-xl p-3.5" style={{ background: 'var(--tint-volt)' }}>
                <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
                  <span className="text-[14px] font-bold" style={{ color: 'var(--v-ink)' }}>{chat.title}</span>
                  <span className="rounded-full px-2 py-0.5 text-[10.5px] font-bold"
                    style={{ background: 'var(--v-steel)', color: 'var(--v-mut)' }}>{chat.typeLabel}</span>
                  <span className="font-mono text-[11.5px]" style={{ color: 'var(--v-dim)' }}>{chat.id}</span>
                  <span className="ml-auto rounded-full px-2.5 py-1 text-[10.5px] font-bold"
                    style={{ background: 'var(--v-volt)', color: 'var(--v-void)' }}>✓ পৌঁছানো যাচ্ছে</span>
                </div>
              </div>
            )}

            <div className="flex flex-wrap gap-2">
              <button onClick={() => go(1)} className="btn-ghost px-4 py-2.5 text-sm font-bold">← পিছনে</button>
              <button onClick={verifyChat} disabled={busy || !chatId}
                className="btn-ghost wz-cta px-4 py-2.5 text-sm font-bold disabled:opacity-50">
                {busy ? <><Orbit /> যাচাই হচ্ছে…</> : 'চ্যাট যাচাই করুন'}
              </button>
              <button onClick={() => go(3)} disabled={!canNext}
                className="btn-primary wz-cta ml-auto px-5 py-2.5 text-sm font-bold disabled:opacity-40">
                পরবর্তী →
              </button>
            </div>
          </div>
        )}

        {/* ───── ধাপ ৪: সংযোগ পরীক্ষা ───── */}
        {step === 3 && (
          <div className="space-y-4">
            <h2 className="text-lg font-bold" style={{ color: 'var(--v-ink)' }}>সংযোগ পরীক্ষা</h2>
            <p className="text-[12.5px] leading-relaxed" style={{ color: 'var(--v-mut)' }}>
              কনফিগ সংরক্ষণ করে একটি সত্যিকারের বার্তা পাঠানো হবে — এতেই প্রমাণ হবে যে
              <strong> সংরক্ষিত</strong> কনফিগ কাজ করছে।
            </p>

            <div className="rounded-xl p-3 font-mono text-[12px]"
              style={{ background: 'var(--v-steel)', color: 'var(--v-mut)' }}>
              ✅ SS UID TOPUP Telegram Integration সফলভাবে সংযুক্ত হয়েছে।
            </div>

            {error && (
              <p className="wz-error rounded-lg p-3 text-[12px]"
                style={{ background: 'var(--tint-violet)', color: 'var(--v-heat)' }}>✕ {error}</p>
            )}

            {testResult && (
              <div className="wz-success space-y-2 rounded-xl p-4" style={{ background: 'var(--tint-volt)' }}>
                <div className="flex items-center gap-2">
                  <span className="wz-burst relative grid h-9 w-9 place-items-center rounded-full text-lg"
                    style={{ background: 'var(--v-volt)', color: 'var(--v-void)' }}>✓</span>
                  <span className="text-[14px] font-bold" style={{ color: 'var(--v-ink)' }}>
                    বার্তা পৌঁছেছে
                  </span>
                </div>
                <dl className="grid gap-1.5 text-[12px] sm:grid-cols-2">
                  {[
                    ['ডেলিভারি সময়', new Date(testResult.deliveredAt).toLocaleTimeString('bn-BD')],
                    ['রেসপন্স টাইম', `${testResult.responseMs} ms`],
                    ['মোট সময়', `${testResult.totalMs} ms`],
                    ['Telegram API', testResult.apiStatus],
                    ['চেষ্টা', String(testResult.attempts)],
                  ].map(([k, v]) => (
                    <div key={k} className="flex justify-between gap-2">
                      <dt style={{ color: 'var(--v-mut)' }}>{k}</dt>
                      <dd className="font-semibold" style={{ color: 'var(--v-ink)' }}>{v}</dd>
                    </div>
                  ))}
                </dl>
              </div>
            )}

            <div className="flex flex-wrap gap-2">
              <button onClick={() => go(2)} className="btn-ghost px-4 py-2.5 text-sm font-bold">← পিছনে</button>
              <button onClick={saveAndTest} disabled={busy}
                className="btn-ghost wz-cta px-4 py-2.5 text-sm font-bold disabled:opacity-50">
                {busy ? <><Orbit /> পাঠানো হচ্ছে…</> : testResult ? 'আবার পাঠান' : 'টেস্ট মেসেজ পাঠান'}
              </button>
              <button onClick={() => go(4)} disabled={!canNext}
                className="btn-primary wz-cta ml-auto px-5 py-2.5 text-sm font-bold disabled:opacity-40">
                পরবর্তী →
              </button>
            </div>
          </div>
        )}

        {/* ───── ধাপ ৫: নোটিফিকেশন পছন্দ ───── */}
        {step === 4 && (
          <div className="space-y-4">
            <h2 className="text-lg font-bold" style={{ color: 'var(--v-ink)' }}>নোটিফিকেশন পছন্দ</h2>
            <p className="text-[12.5px] leading-relaxed" style={{ color: 'var(--v-mut)' }}>
              কোন ঘটনায় টেলিগ্রামে বার্তা যাবে? পরে ড্যাশবোর্ড থেকেও বদলানো যাবে।
            </p>

            {GROUP_ORDER.map((g) => {
              const items = events.filter((e) => e.group === g);
              if (!items.length) return null;
              return (
                <div key={g} className="wz-rise">
                  <p className="mb-1.5 text-[12px] font-bold" style={{ color: 'var(--v-mut)' }}>
                    {GROUP_LABEL[g]}
                  </p>
                  <div className="grid gap-1.5 sm:grid-cols-2">
                    {items.map((ev) => (
                      <label key={ev.key}
                        className="flex cursor-pointer items-start gap-2.5 rounded-lg p-2.5"
                        style={{ background: 'var(--v-steel)' }}>
                        <input
                          type="checkbox"
                          checked={ev.enabled}
                          onChange={(e) =>
                            setEvents((xs) => xs.map((x) => x.key === ev.key ? { ...x, enabled: e.target.checked } : x))
                          }
                          className="mt-0.5 h-4 w-4 cursor-pointer"
                          aria-label={ev.label}
                        />
                        <span className="min-w-0">
                          <span className="block text-[12.5px] font-semibold" style={{ color: 'var(--v-ink)' }}>
                            {ev.label}
                            {!ev.wired && (
                              <span className="ml-1.5 rounded px-1.5 py-0.5 text-[9.5px] font-bold align-middle"
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

            {error && (
              <p className="wz-error rounded-lg p-3 text-[12px]"
                style={{ background: 'var(--tint-violet)', color: 'var(--v-heat)' }}>✕ {error}</p>
            )}

            <div className="flex flex-wrap gap-2">
              <button onClick={() => go(3)} className="btn-ghost px-4 py-2.5 text-sm font-bold">← পিছনে</button>
              <button onClick={savePrefs} disabled={busy}
                className="btn-primary wz-cta ml-auto px-5 py-2.5 text-sm font-bold disabled:opacity-50">
                {busy ? <><Orbit /> সেভ হচ্ছে…</> : 'সংরক্ষণ করে শেষ করুন →'}
              </button>
            </div>
          </div>
        )}

        {/* ───── ধাপ ৬: সম্পন্ন ───── */}
        {step === 5 && (
          <div className="space-y-5 py-4 text-center">
            <div className="flex justify-center">
              <span className="wz-burst wz-success relative grid h-20 w-20 place-items-center rounded-full text-4xl"
                style={{ background: 'var(--v-volt)', color: 'var(--v-void)' }}>✓</span>
            </div>
            <div>
              <h2 className="text-xl font-bold" style={{ color: 'var(--v-ink)' }}>
                টেলিগ্রাম সফলভাবে কনফিগার হয়েছে
              </h2>
              <p className="mx-auto mt-1.5 max-w-md text-[12.5px] leading-relaxed" style={{ color: 'var(--v-mut)' }}>
                {bot ? <>বট <strong>@{bot.username}</strong> এখন </> : 'বট এখন '}
                আপনার নির্বাচিত ঘটনাগুলোতে বার্তা পাঠাবে।
                টোকেন এনক্রিপ্ট করে সংরক্ষিত — কোনো ফাইল সম্পাদনার দরকার নেই।
              </p>
            </div>

            <div className="flex flex-wrap justify-center gap-2">
              <button
                onClick={() => { router.refresh(); onClose?.(); }}
                className="btn-ghost wz-cta px-5 py-2.5 text-sm font-bold"
              >
                শেষ করুন
              </button>
              <button
                onClick={() => { router.refresh(); onClose?.(); }}
                className="btn-primary wz-cta px-5 py-2.5 text-sm font-bold"
              >
                টেলিগ্রাম ড্যাশবোর্ডে যান →
              </button>
            </div>
          </div>
        )}
      </div>

      {step < 5 && onClose && (
        <button onClick={onClose} className="mx-auto block text-[11.5px] underline"
          style={{ color: 'var(--v-dim)' }}>
          পরে করব — উইজার্ড বন্ধ করুন
        </button>
      )}
    </div>
  );
}
