'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { useToast } from './Toast';
import ImageUploader from './ImageUploader';

type Channel = {
  id: number; method: string; accountNo: string;
  accountType: string; instruction: string;
};

const QUICK = [50, 100, 200, 500, 1000, 2000];

/** ★ প্রতিটি মাধ্যমের অফিসিয়াল ব্র্যান্ড রঙ।
 *  ⚠️ রঙটি এখন **কেবল দণ্ড ও আভায়** ব্যবহার হয়, লেখার পটভূমিতে নয় —
 *  কারণ এই রঙগুলোর উপর সাদা লেখার কনট্রাস্ট WCAG পার করে না
 *  (Nagad এর ক্ষেত্রে ৪.৩৫:১)। ব্র্যান্ড অক্ষত, পাঠযোগ্যতাও। */
const BRAND: Record<string, string> = {
  BKASH: '#E2136E',
  NAGAD: '#EE1C25',
  ROCKET: '#8C3494',
  UPAY: '#F58220',
};

export default function DepositForm({
  channels, min, max,
}: {
  channels: Channel[];
  min: number;
  max: number;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const toast = useToast();

  const [ch, setCh] = useState<Channel | null>(channels[0] ?? null);
  const [amount, setAmount] = useState('');
  const [trxId, setTrxId] = useState('');
  // ★ TrxID আগে ব্যবহৃত কিনা — blur এ যাচাই (2.15)
  const [trxDupe, setTrxDupe] = useState(false);
  const [trxChecking, setTrxChecking] = useState(false);
  const [senderNo, setSenderNo] = useState('');
  const [shot, setShot] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [loading, setLoading] = useState(false);
  const [errs, setErrs] = useState<Record<string, string>>({});

  function copyNo() {
    if (!ch) return;
    navigator.clipboard
      .writeText(ch.accountNo)
      .then(() => {
        setCopied(true);
        toast.success('নাম্বার কপি হয়েছে');
        setTimeout(() => setCopied(false), 2000);
      })
      .catch(() => toast.error('কপি করা যায়নি — নাম্বারটি লিখে নিন'));
  }

  function validate(): boolean {
    const e: Record<string, string> = {};
    const amt = Number(amount);

    if (!amount || isNaN(amt) || amt <= 0) e.amount = 'সঠিক পরিমাণ দিন';
    else if (amt < min) e.amount = `সর্বনিম্ন ৳${min}`;
    else if (amt > max) e.amount = `সর্বোচ্চ ৳${max}`;

    const t = trxId.trim().toUpperCase();
    if (!t) e.trxId = 'ট্রানজেকশন আইডি দিন';
    else if (t.length < 6) e.trxId = 'TrxID কমপক্ষে ৬ অক্ষর';
    else if (!/^[A-Z0-9]+$/.test(t)) e.trxId = 'শুধু অক্ষর ও সংখ্যা চলবে';

    if (!/^01[3-9]\d{8}$/.test(senderNo.trim())) e.senderNo = 'সঠিক মোবাইল নাম্বার দিন';

    setErrs(e);
    return Object.keys(e).length === 0;
  }

  /**
   * ★ TrxID আগে ব্যবহৃত কিনা দেখি — ফর্ম ছাড়ার সাথে সাথেই।
   *   ব্যর্থ হলে নীরব: এটি সুবিধা মাত্র, সত্যিকারের বাধা সার্ভারেই
   *   (unique constraint) — তাই এখানে ব্যর্থতা বিক্রি আটকাবে না।
   */
  async function checkTrxDuplicate(raw: string) {
    const t = raw.trim().toUpperCase();
    if (t.length < 6 || !/^[A-Z0-9]+$/.test(t)) {
      setTrxDupe(false);
      return;
    }
    setTrxChecking(true);
    try {
      const res = await fetch('/api/deposit/check-trx', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ trxId: t }),
      });
      if (res.ok) setTrxDupe(Boolean((await res.json()).used));
    } catch {
      /* নীরব — সার্ভারই চূড়ান্ত রক্ষাকবচ */
    } finally {
      setTrxChecking(false);
    }
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!ch) return toast.error('পেমেন্ট মাধ্যম বেছে নিন');
    if (!validate()) return;

    setLoading(true);
    try {
      const res = await fetch('/api/deposit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          method: ch.method,
          amount: Number(amount),
          trxId: trxId.trim().toUpperCase(),
          senderNo: senderNo.trim(),
          screenshot: shot || undefined,
        }),
      });
      const d = await res.json();
      if (!res.ok) throw new Error(d.error);

      toast.success(d.message);
      setAmount('');
      setTrxId('');
      setSenderNo('');
      setShot(null);
      setErrs({});
      startTransition(() => router.refresh());
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'রিকোয়েস্ট পাঠানো যায়নি');
    } finally {
      setLoading(false);
    }
  }

  if (channels.length === 0) {
    return (
      <div className="card p-8 text-center">
        <p style={{ color: 'var(--v-ink)' }}>কোনো পেমেন্ট মাধ্যম চালু নেই।</p>
        <p className="mt-1 text-sm" style={{ color: 'var(--v-mut)' }}>অ্যাডমিনের সাথে যোগাযোগ করুন।</p>
      </div>
    );
  }

  return (
    <div className="grid gap-5 lg:grid-cols-2">
      {/* ── বাম: নির্দেশনা ── */}
      <section className="card p-4 sm:p-5" aria-labelledby="d1">
        {/* ★ প্রথমবার যে বুঝবে না তার জন্য */}
        <div className="mb-5 p-4" style={{ border: '1px solid rgba(125,227,255,.3)', background: 'rgba(125,227,255,.07)', borderRadius: 2 }}>
          <p className="hud mb-3">কীভাবে টাকা যোগ হয়</p>
          <ol className="space-y-2 text-[13px] leading-relaxed" style={{ color: 'var(--v-mut)' }}>
            <li>
              <strong>১.</strong> নিচের নাম্বারে bKash/Nagad দিয়ে <strong>Send Money</strong> করুন
            </li>
            <li>
              <strong>২.</strong> যে <strong>TrxID</strong> পাবেন সেটা <strong>“২. তথ্য জমা দিন”</strong> অংশে লিখুন
            </li>
            <li>
              <strong>৩.</strong> আমরা মিলিয়ে দেখে <strong>৫–৩০ মিনিটে</strong> টাকা যোগ করে দেব
            </li>
          </ol>
        </div>

        <h2 id="d1" className="mb-4 text-lg font-extrabold" style={{ color: 'var(--v-ink)' }}>১. টাকা পাঠান</h2>

        <div className="mb-4 grid grid-cols-2 gap-2 sm:grid-cols-3" role="radiogroup" aria-label="পেমেন্ট মাধ্যম">
          {channels.map((c: (typeof channels)[number]) => (
            <button
              key={c.id}
              type="button"
              role="radio"
              aria-checked={ch?.id === c.id}
              onClick={() => setCh(c)}
              className="v-hud inline-flex min-h-[46px] w-full items-center justify-center px-3 text-sm font-bold transition"
              style={{
                borderRadius: 2,
                border: ch?.id === c.id ? '1px solid var(--violet)' : '1px solid var(--v-edge2)',
                background: ch?.id === c.id ? 'rgba(139,92,246,.16)' : 'var(--v-steel)',
                color: ch?.id === c.id ? 'var(--violet)' : 'var(--v-mut)',
                boxShadow: ch?.id === c.id ? 'inset 0 0 0 1px var(--violet)' : undefined,
              }}
            >
              {c.method}
            </button>
          ))}
        </div>

        {ch && (
          <>
            {/* ═══ অ্যাকাউন্ট নম্বর ═══
                এই সাইটের সবচেয়ে গুরুত্বপূর্ণ একক তথ্য — গ্রাহক এটি
                কপি করে নিজের ব্যাংকিং অ্যাপে টাকা পাঠান। একটি অঙ্ক
                ভুল পড়লে টাকা অন্য কারো কাছে চলে যায়।

                ⚠️ আগে এটি ছিল ব্র্যান্ড-রঙের গ্রেডিয়েন্টে সাদা লেখা —
                অর্থাৎ লাল/গোলাপির উপর সাদা, লেবেলটি আবার `text-white/80`
                (মাপা ~৩.৫:১)। যে সংখ্যাটি ভুল পড়লে টাকা হারায়, সেটিকে
                সাজসজ্জার জন্য কম পাঠযোগ্য রাখা যায় না।

                এখন: গাঢ় পৃষ্ঠতল, লেখা `--v-ink` (১৯.৪:১), আর ব্র্যান্ডের
                রঙ থাকে উপরের দণ্ড ও আভায় — মাধ্যমটি ঠিক আগের মতোই
                চেনা যায়। */}
            <div
              className="relative overflow-hidden p-5 text-center sm:p-6"
              style={{
                border: '1px solid var(--v-edge2)',
                background: 'var(--v-steel)',
                boxShadow: `0 0 60px -30px ${BRAND[ch.method] ?? 'var(--v-volt)'}`,
              }}
            >
              <span
                aria-hidden="true"
                className="absolute inset-x-0 top-0 h-1"
                style={{ background: BRAND[ch.method] ?? 'var(--v-volt)' }}
              />
              <p className="label mb-0" style={{ color: 'var(--v-mut)' }}>
                {ch.method} — {ch.accountType}
              </p>
              <p
                className="my-3 select-all font-mono text-2xl font-extrabold tracking-[.12em] sm:text-3xl"
                style={{ color: 'var(--v-ink)' }}
              >
                {ch.accountNo}
              </p>
              <button onClick={copyNo} type="button" className="btn-ghost min-h-[44px] text-xs">
                {copied ? (
                  <>
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--v-volt)" strokeWidth="3" aria-hidden="true"><path d="M20 6L9 17l-5-5" /></svg>
                    কপি হয়েছে
                  </>
                ) : (
                  <>
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                      <rect x="9" y="9" width="12" height="12" rx="1.5" /><path d="M5 15V4a1 1 0 0 1 1-1h9" />
                    </svg>
                    নাম্বার কপি করুন
                  </>
                )}
              </button>
            </div>

            {ch.instruction && (
              <p className="mt-4 rounded-lg bg-slate-50 p-3.5 text-sm leading-relaxed text-slate-600">
                {ch.instruction}
              </p>
            )}
          </>
        )}

        <div className="alert-warn mt-4 text-xs leading-relaxed">
          ⚠️ <strong>Send Money</strong> করুন, <strong>Cash Out</strong> নয়। ভুল TrxID দিলে
          রিকোয়েস্ট বাতিল হবে। একই TrxID দুইবার ব্যবহার করা যাবে না।
        </div>
      </section>

      {/* ── ডান: ফর্ম ── */}
      <form onSubmit={submit} noValidate className="card space-y-4 p-4 sm:p-5" aria-labelledby="d2">
        <h2 id="d2" className="text-lg font-bold text-slate-900">২. তথ্য জমা দিন</h2>

        <div>
          <label htmlFor="amt" className="label">পরিমাণ (৳{min} – ৳{max})</label>
          <input
            id="amt" className="input" type="number" inputMode="numeric"
            min={min} max={max} value={amount}
            onChange={(e) => setAmount(e.target.value)}
            placeholder="যত টাকা পাঠিয়েছেন"
            aria-invalid={Boolean(errs.amount)}
          />
          {errs.amount && <p role="alert" className="mt-1 text-xs text-red-600">{errs.amount}</p>}

          <div className="mt-2 flex flex-wrap gap-1.5">
            {QUICK.filter((q: (typeof QUICK)[number]) => q >= min && q <= max).map((q) => (
              <button
                key={q}
                type="button"
                onClick={() => setAmount(String(q))}
                className="v-hud inline-flex min-h-[40px] items-center px-3.5 text-xs font-bold transition"
                style={{ border: '1px solid var(--v-edge2)', background: 'var(--v-steel)', color: 'var(--v-ink)', borderRadius: 2 }}
              >
                ৳{q}
              </button>
            ))}
          </div>
        </div>

        <div>
          <label htmlFor="trx" className="label">ট্রানজেকশন আইডি (TrxID)</label>
          <input
            id="trx" className="input font-mono uppercase"
            value={trxId}
            onChange={(e) => {
              setTrxId(e.target.value.toUpperCase());
              if (trxDupe) setTrxDupe(false); // টাইপ করলেই সতর্কতা মুছে যায়
            }}
            onBlur={(e) => checkTrxDuplicate(e.target.value)}
            placeholder="যেমন: 9A7B2C4D1E"
            autoComplete="off"
            aria-invalid={Boolean(errs.trxId) || trxDupe}
            aria-describedby="trx-msg"
          />
          <div id="trx-msg">
            {errs.trxId && <p role="alert" className="mt-1 text-xs text-red-600">{errs.trxId}</p>}
            {/* ★ ফর্ম ছাড়ার সাথে সাথেই ডুপ্লিকেট ধরা (2.15) — সাবমিটের
                পর বা ২০ মিনিট অপেক্ষার পর নয় */}
            {trxChecking && (
              <p className="mt-1 text-xs" style={{ color: 'var(--mut)' }}>যাচাই করা হচ্ছে…</p>
            )}
            {trxDupe && !errs.trxId && (
              <p role="alert" className="mt-1 text-xs" style={{ color: 'var(--red)' }}>
                ⚠️ এই TrxID আগে ব্যবহার করা হয়েছে। নতুন পেমেন্টের TrxID দিন —
                একই পেমেন্ট দুইবার জমা দেওয়া যায় না।
              </p>
            )}
          </div>
        </div>

        <div>
          <label htmlFor="snd" className="label">যে নাম্বার থেকে পাঠিয়েছেন</label>
          <input
            id="snd" className="input" type="tel" inputMode="numeric"
            value={senderNo}
            onChange={(e) => setSenderNo(e.target.value)}
            placeholder="01XXXXXXXXX"
            autoComplete="tel"
            aria-invalid={Boolean(errs.senderNo)}
          />
          {errs.senderNo && <p role="alert" className="mt-1 text-xs text-red-600">{errs.senderNo}</p>}
        </div>

        <ImageUploader
          value={shot}
          onChange={setShot}
          endpoint="/api/upload"
          folder="deposits"
          label="স্ক্রিনশট (ঐচ্ছিক)"
          hint="পেমেন্টের স্ক্রিনশট দিলে দ্রুত অনুমোদন হবে"
          aspect="aspect-[4/3]"
        />

        <button type="submit" disabled={loading} className="btn-primary w-full py-3">
          {loading ? 'জমা হচ্ছে...' : 'রিকোয়েস্ট পাঠান'}
        </button>

        <p className="text-center text-xs text-slate-400">
          অ্যাডমিন যাচাই করার পর ব্যালেন্স যোগ হবে (৫–৩০ মিনিট)।
        </p>
      </form>
    </div>
  );
}
