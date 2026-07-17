'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { motion, AnimatePresence } from 'framer-motion';
import { useToast } from './Toast';

export default function ProfileEditor({
  name: initName, phone: initPhone, email,
}: {
  name: string;
  phone: string;
  email: string;
}) {
  const router = useRouter();
  const toast = useToast();
  const [, startTransition] = useTransition();

  const [tab, setTab] = useState<'info' | 'password'>('info');

  // ── প্রোফাইল ──
  const [name, setName] = useState(initName);
  const [phone, setPhone] = useState(initPhone);
  const [saving, setSaving] = useState(false);

  // ── পাসওয়ার্ড ──
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [show, setShow] = useState(false);
  const [changing, setChanging] = useState(false);

  const dirty = name !== initName || phone !== initPhone;

  // পাসওয়ার্ডের শক্তি
  const strength = (() => {
    if (!next) return null;
    let score = 0;
    if (next.length >= 8) score++;
    if (next.length >= 12) score++;
    if (/[a-z]/.test(next) && /[A-Z]/.test(next)) score++;
    if (/[0-9]/.test(next)) score++;
    if (/[^a-zA-Z0-9]/.test(next)) score++;
    return score; // 0–5
  })();

  const strengthMeta = [
    { label: 'খুব দুর্বল', cls: 'bg-red-500',     w: '20%' },
    { label: 'দুর্বল',    cls: 'bg-orange-500',  w: '35%' },
    { label: 'মোটামুটি', cls: 'bg-amber-500',   w: '55%' },
    { label: 'ভালো',     cls: 'bg-lime-500',    w: '75%' },
    { label: 'শক্তিশালী', cls: 'bg-emerald-500', w: '90%' },
    { label: 'দুর্দান্ত',  cls: 'bg-emerald-600', w: '100%' },
  ];

  async function saveProfile() {
    if (name.trim().length < 2) return toast.error('সঠিক নাম দিন');
    if (!/^01[3-9]\d{8}$/.test(phone.trim())) return toast.error('সঠিক মোবাইল নাম্বার দিন');

    setSaving(true);
    try {
      const res = await fetch('/api/account/profile', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: name.trim(), phone: phone.trim() }),
      });
      const d = await res.json();
      if (!res.ok) throw new Error(d.error);

      toast.success(d.message);
      startTransition(() => router.refresh());
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'সেভ করা যায়নি');
    } finally {
      setSaving(false);
    }
  }

  async function changePassword() {
    if (!current) return toast.error('বর্তমান পাসওয়ার্ড দিন');
    if (next.length < 8) return toast.error('নতুন পাসওয়ার্ড কমপক্ষে ৮ অক্ষর');
    if (!/[0-9]/.test(next)) return toast.error('অন্তত একটি সংখ্যা থাকতে হবে');
    if (next !== confirm) return toast.error('দুইটা পাসওয়ার্ড মিলছে না');

    setChanging(true);
    try {
      const res = await fetch('/api/account/password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ current, next }),
      });
      const d = await res.json();
      if (!res.ok) throw new Error(d.error);

      toast.success(d.message);
      setCurrent('');
      setNext('');
      setConfirm('');
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'বদলানো যায়নি');
    } finally {
      setChanging(false);
    }
  }

  return (
    <section className="card overflow-hidden">
      {/* ── ট্যাব ── */}
      <div className="relative flex border-b border-slate-200">
        {(['info', 'password'] as const).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`relative flex-1 px-4 py-3.5 text-sm font-bold transition ${
              tab === t ? 'text-rose-600' : 'text-slate-400 hover:text-slate-700'
            }`}
          >
            {t === 'info' ? '👤 আমার তথ্য' : '🔒 পাসওয়ার্ড'}

            {/* ★ স্লাইড করে যাওয়া আন্ডারলাইন */}
            {tab === t && (
              <motion.span
                layoutId="profile-tab"
                className="absolute inset-x-0 bottom-0 h-[3px] bg-rose-600"
                transition={{ type: 'spring', stiffness: 380, damping: 30 }}
              />
            )}
          </button>
        ))}
      </div>

      <div className="p-5 sm:p-6">
        <AnimatePresence mode="wait">
          {tab === 'info' ? (
            <motion.div
              key="info"
              initial={{ opacity: 0, x: -12 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: 12 }}
              transition={{ duration: 0.18 }}
              className="space-y-4"
            >
              <div>
                <label htmlFor="pname" className="label">নাম</label>
                <input
                  id="pname"
                  className="input"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="আপনার নাম"
                />
              </div>

              <div>
                <label htmlFor="pphone" className="label">মোবাইল নাম্বার</label>
                <input
                  id="pphone"
                  className="input"
                  type="tel"
                  inputMode="numeric"
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  placeholder="01712345678"
                />
              </div>

              <div>
                <label className="label">ইমেইল</label>
                <input className="input" value={email} disabled />
                <p className="mt-1 text-xs text-slate-400">
                  ইমেইল বদলানো যায় না — সাপোর্টে যোগাযোগ করুন।
                </p>
              </div>

              <AnimatePresence>
                {dirty && (
                  <motion.div
                    initial={{ opacity: 0, y: -8, height: 0 }}
                    animate={{ opacity: 1, y: 0, height: 'auto' }}
                    exit={{ opacity: 0, y: -8, height: 0 }}
                  >
                    <button
                      onClick={saveProfile}
                      disabled={saving}
                      className="btn-primary w-full py-3"
                    >
                      {saving ? 'সেভ হচ্ছে...' : '✓ পরিবর্তন সেভ করুন'}
                    </button>
                  </motion.div>
                )}
              </AnimatePresence>
            </motion.div>
          ) : (
            <motion.div
              key="password"
              initial={{ opacity: 0, x: 12 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -12 }}
              transition={{ duration: 0.18 }}
              className="space-y-4"
            >
              <div>
                <label htmlFor="cpw" className="label">বর্তমান পাসওয়ার্ড</label>
                <input
                  id="cpw"
                  className="input"
                  type={show ? 'text' : 'password'}
                  value={current}
                  onChange={(e) => setCurrent(e.target.value)}
                  autoComplete="current-password"
                />
              </div>

              <div>
                <label htmlFor="npw" className="label">নতুন পাসওয়ার্ড</label>
                <div className="relative">
                  <input
                    id="npw"
                    className="input pr-11"
                    type={show ? 'text' : 'password'}
                    value={next}
                    onChange={(e) => setNext(e.target.value)}
                    placeholder="৮+ অক্ষর, অন্তত ১টি সংখ্যা"
                    autoComplete="new-password"
                  />
                  <button
                    type="button"
                    onClick={() => setShow(!show)}
                    aria-label={show ? 'লুকান' : 'দেখান'}
                    className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-2 text-slate-400 hover:text-slate-700"
                  >
                    {show ? '🙈' : '👁'}
                  </button>
                </div>

                {/* ★ পাসওয়ার্ড শক্তি — লাইভ বার */}
                <AnimatePresence>
                  {strength !== null && (
                    <motion.div
                      initial={{ opacity: 0, height: 0 }}
                      animate={{ opacity: 1, height: 'auto' }}
                      exit={{ opacity: 0, height: 0 }}
                      className="mt-2"
                    >
                      <div className="h-1.5 overflow-hidden rounded-full bg-slate-200">
                        <motion.div
                          className={`h-full rounded-full ${strengthMeta[strength].cls}`}
                          initial={{ width: 0 }}
                          animate={{ width: strengthMeta[strength].w }}
                          transition={{ type: 'spring', stiffness: 200, damping: 25 }}
                        />
                      </div>
                      <p className="mt-1 text-xs font-semibold text-slate-500">
                        {strengthMeta[strength].label}
                      </p>
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>

              <div>
                <label htmlFor="cfpw" className="label">নতুন পাসওয়ার্ড আবার</label>
                <input
                  id="cfpw"
                  className="input"
                  type={show ? 'text' : 'password'}
                  value={confirm}
                  onChange={(e) => setConfirm(e.target.value)}
                  autoComplete="new-password"
                  aria-invalid={Boolean(confirm && next !== confirm)}
                />
                <AnimatePresence>
                  {confirm && next !== confirm && (
                    <motion.p
                      initial={{ opacity: 0 }}
                      animate={{ opacity: 1 }}
                      exit={{ opacity: 0 }}
                      className="mt-1 text-xs text-red-600"
                    >
                      দুইটা পাসওয়ার্ড মিলছে না
                    </motion.p>
                  )}
                </AnimatePresence>
              </div>

              <button
                onClick={changePassword}
                disabled={changing || !current || !next || next !== confirm}
                className="btn-primary w-full py-3"
              >
                {changing ? 'বদলানো হচ্ছে...' : '🔒 পাসওয়ার্ড বদলান'}
              </button>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </section>
  );
}
