'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { useToast, ConfirmDialog } from '@/components/Toast';
import { SocialIcon, SOCIAL_META } from '@/components/SocialIcons';

type Social = {
  id: number; platform: string; url: string; label: string | null; isActive: boolean;
};
type Payment = {
  id: number; method: string; accountNo: string; accountType: string;
  instruction: string | null; isActive: boolean;
};

type Tab = 'general' | 'social' | 'payment';

const TABS: { id: Tab; label: string }[] = [
  { id: 'general', label: '⚙️ সাধারণ' },
  { id: 'social', label: '🔗 সোশ্যাল লিংক' },
  { id: 'payment', label: '💳 পেমেন্ট নাম্বার' },
];

const PLATFORMS = Object.keys(SOCIAL_META);
const METHODS = ['BKASH', 'NAGAD', 'ROCKET', 'UPAY'];

export default function SiteManager({
  settings, socials, payments,
}: {
  settings: Record<string, string>;
  socials: Social[];
  payments: Payment[];
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const toast = useToast();

  const [tab, setTab] = useState<Tab>('general');
  const [busy, setBusy] = useState(false);

  // ── General ──
  const [s, setS] = useState({
    site_name: settings.site_name || 'UID TopUp',
    site_notice: settings.site_notice || '',
    hero_title: settings.hero_title || '',
    hero_subtitle: settings.hero_subtitle || '',
    min_deposit: settings.min_deposit || '20',
    max_deposit: settings.max_deposit || '25000',
    referral_bonus: settings.referral_bonus || '20',
    referral_min_deposit: settings.referral_min_deposit || '100',
    support_email: settings.support_email || '',
    support_phone: settings.support_phone || '',
    support_hours: settings.support_hours || '',
  });

  // ── Social ──
  const [newSocial, setNewSocial] = useState({ platform: 'facebook', url: '', label: '' });
  const [delSocial, setDelSocial] = useState<Social | null>(null);

  // ── Payment ──
  const [newPay, setNewPay] = useState({
    method: 'BKASH', accountNo: '', accountType: 'Personal', instruction: '',
  });
  const [delPay, setDelPay] = useState<Payment | null>(null);

  async function call(url: string, method: string, body: unknown, msg: string) {
    setBusy(true);
    try {
      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const d = await res.json();
      if (!res.ok) throw new Error(d.error);
      toast.success(msg);
      startTransition(() => router.refresh());
      return true;
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'কাজটি করা যায়নি');
      return false;
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-5">
      {/* Tabs */}
      <div className="flex gap-1 overflow-x-auto border-b border-slate-200" role="tablist">
        {TABS.map((t: (typeof TABS)[number]) => (
          <button
            key={t.id}
            role="tab"
            aria-selected={tab === t.id}
            onClick={() => setTab(t.id)}
            className={`shrink-0 whitespace-nowrap border-b-2 px-4 py-2.5 text-sm font-medium transition ${
              tab === t.id
                ? 'border-purple-500 text-slate-900'
                : 'border-transparent text-slate-400 hover:text-slate-900'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* ═══ সাধারণ ═══ */}
      {tab === 'general' && (
        <div className="card space-y-5 p-5">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="sm:col-span-2">
              <label className="label">সাইটের নাম</label>
              <input aria-label="সাইটের নাম"
                className="input"
                value={s.site_name}
                onChange={(e) => setS({ ...s, site_name: e.target.value })}
              />
            </div>

            <div className="sm:col-span-2">
              <label className="label">নোটিশ (হোমপেজে দেখাবে)</label>
              <input aria-label="নোটিশ (হোমপেজে দেখাবে)"
                className="input"
                value={s.site_notice}
                onChange={(e) => setS({ ...s, site_notice: e.target.value })}
                placeholder="যেমন: ঈদ উপলক্ষে সব প্যাকেজে ১০% ছাড়!"
              />
              <p className="mt-1 text-xs text-slate-400">খালি রাখলে নোটিশ দেখাবে না।</p>
            </div>

            <div>
              <label className="label">হিরো শিরোনাম</label>
              <input aria-label="হিরো শিরোনাম"
                className="input"
                value={s.hero_title}
                onChange={(e) => setS({ ...s, hero_title: e.target.value })}
                placeholder="ফ্রি ফায়ার ডায়মন্ড টপ আপ"
              />
            </div>

            <div>
              <label className="label">হিরো উপশিরোনাম</label>
              <input aria-label="হিরো উপশিরোনাম"
                className="input"
                value={s.hero_subtitle}
                onChange={(e) => setS({ ...s, hero_subtitle: e.target.value })}
                placeholder="কম দামে, দ্রুত ডেলিভারি"
              />
            </div>

            <div>
              <label className="label">সর্বনিম্ন ডিপোজিট (৳)</label>
              <input aria-label="সর্বনিম্ন ডিপোজিট (৳)"
                className="input" type="number"
                value={s.min_deposit}
                onChange={(e) => setS({ ...s, min_deposit: e.target.value })}
              />
            </div>

            <div>
              <label className="label">সর্বোচ্চ ডিপোজিট (৳)</label>
              <input aria-label="সর্বোচ্চ ডিপোজিট (৳)"
                className="input" type="number"
                value={s.max_deposit}
                onChange={(e) => setS({ ...s, max_deposit: e.target.value })}
              />
            </div>

            <div>
              <label className="label">রেফারেল বোনাস (৳)</label>
              <input aria-label="রেফারেল বোনাস (৳)"
                className="input" type="number"
                value={s.referral_bonus}
                onChange={(e) => setS({ ...s, referral_bonus: e.target.value })}
              />
              <p className="mt-1 text-xs text-slate-400">রেফারার এই টাকা পাবে</p>
            </div>

            <div>
              <label className="label">বোনাসের জন্য সর্বনিম্ন ডিপোজিট (৳)</label>
              <input aria-label="বোনাসের জন্য সর্বনিম্ন ডিপোজিট (৳)"
                className="input" type="number"
                value={s.referral_min_deposit}
                onChange={(e) => setS({ ...s, referral_min_deposit: e.target.value })}
              />
              <p className="mt-1 text-xs text-slate-400">নতুন ইউজার এত টাকা ডিপোজিট করলে বোনাস</p>
            </div>

            <div>
              <label className="label">সাপোর্ট ইমেইল</label>
              <input aria-label="সাপোর্ট ইমেইল"
                className="input" type="email"
                value={s.support_email}
                onChange={(e) => setS({ ...s, support_email: e.target.value })}
              />
            </div>

            <div>
              <label className="label">সাপোর্ট ফোন</label>
              <input aria-label="সাপোর্ট ফোন"
                className="input"
                value={s.support_phone}
                onChange={(e) => setS({ ...s, support_phone: e.target.value })}
              />
            </div>

            <div className="sm:col-span-2">
              <label className="label">সাপোর্ট সময়</label>
              <input aria-label="সাপোর্ট সময়"
                className="input"
                value={s.support_hours}
                onChange={(e) => setS({ ...s, support_hours: e.target.value })}
                placeholder="সকাল ৯টা – রাত ১১টা"
              />
            </div>
          </div>

          <button
            onClick={() => call('/api/admin/settings', 'POST', s, 'সেটিংস সেভ হয়েছে')}
            disabled={busy}
            className="btn-primary"
          >
            {busy ? 'সেভ হচ্ছে...' : 'সেভ করুন'}
          </button>
        </div>
      )}

      {/* ═══ সোশ্যাল ═══ */}
      {tab === 'social' && (
        <div className="space-y-5">
          <div className="card space-y-4 p-5">
            <h2 className="font-semibold text-slate-900">নতুন সোশ্যাল লিংক</h2>

            <div className="grid gap-4 sm:grid-cols-3">
              <div>
                <label className="label">প্ল্যাটফর্ম</label>
                <select aria-label="প্ল্যাটফর্ম"
                  className="input"
                  value={newSocial.platform}
                  onChange={(e) => setNewSocial({ ...newSocial, platform: e.target.value })}
                >
                  {PLATFORMS.map((p: (typeof PLATFORMS)[number]) => (
                    <option key={p} value={p}>{SOCIAL_META[p].label}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="label">লিংক</label>
                <input aria-label="লিংক"
                  className="input"
                  value={newSocial.url}
                  onChange={(e) => setNewSocial({ ...newSocial, url: e.target.value })}
                  placeholder="https://facebook.com/yourpage"
                />
              </div>
              <div>
                <label className="label">লেবেল (ঐচ্ছিক)</label>
                <input aria-label="লেবেল (ঐচ্ছিক)"
                  className="input"
                  value={newSocial.label}
                  onChange={(e) => setNewSocial({ ...newSocial, label: e.target.value })}
                  placeholder="আমাদের পেজ"
                />
              </div>
            </div>

            <button
              onClick={async () => {
                if (!newSocial.url.trim()) return toast.error('লিংক দিন');
                const ok = await call('/api/admin/social', 'POST', newSocial, 'লিংক যোগ হয়েছে');
                if (ok) setNewSocial({ platform: 'facebook', url: '', label: '' });
              }}
              disabled={busy}
              className="btn-primary"
            >
              লিংক যোগ করুন
            </button>
          </div>

          <div className="space-y-3">
            {socials.map((so: (typeof socials)[number]) => {
              const meta = SOCIAL_META[so.platform];
              return (
                <div key={so.id} className="card flex items-center gap-3 p-4">
                  <div className="grid h-10 w-10 shrink-0 place-items-center rounded-lg border border-slate-200 bg-slate-100 text-slate-400">
                    <SocialIcon platform={so.platform} size={20} />
                  </div>

                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium text-slate-900">
                      {so.label || meta?.label || so.platform}
                    </p>
                    <a
                      href={so.url}
                      target="_blank"
                      rel="noopener noreferrer nofollow"
                      className="block truncate text-xs text-rose-600 hover:underline"
                    >
                      {so.url}
                    </a>
                  </div>

                  <div className="flex shrink-0 gap-1.5">
                    <button
                      disabled={busy}
                      onClick={() =>
                        call(
                          '/api/admin/social',
                          'PATCH',
                          { id: so.id, isActive: !so.isActive },
                          so.isActive ? 'লিংক বন্ধ' : 'লিংক চালু'
                        )
                      }
                      className={`badge ${
                        so.isActive
                          ? 'border border-emerald-200 bg-emerald-100 text-emerald-700'
                          : 'border border-slate-200 bg-slate-100 text-slate-400'
                      }`}
                    >
                      {so.isActive ? '●' : '○'}
                    </button>
                    <button
                      disabled={busy}
                      onClick={() => setDelSocial(so)}
                      className="btn-danger px-2.5 py-1 text-xs"
                    >
                      🗑
                    </button>
                  </div>
                </div>
              );
            })}
            {socials.length === 0 && (
              <p className="card py-12 text-center text-slate-400">কোনো সোশ্যাল লিংক নেই</p>
            )}
          </div>
        </div>
      )}

      {/* ═══ পেমেন্ট ═══ */}
      {tab === 'payment' && (
        <div className="space-y-5">
          <div className="card space-y-4 p-5">
            <h2 className="font-semibold text-slate-900">নতুন পেমেন্ট নাম্বার</h2>

            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              <div>
                <label className="label">মাধ্যম</label>
                <select aria-label="মাধ্যম"
                  className="input"
                  value={newPay.method}
                  onChange={(e) => setNewPay({ ...newPay, method: e.target.value })}
                >
                  {METHODS.map((m: (typeof METHODS)[number]) => (
                    <option key={m} value={m}>{m}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="label">নাম্বার</label>
                <input aria-label="নাম্বার"
                  className="input font-mono"
                  value={newPay.accountNo}
                  onChange={(e) => setNewPay({ ...newPay, accountNo: e.target.value })}
                  placeholder="01712345678"
                />
              </div>
              <div>
                <label className="label">ধরন</label>
                <select aria-label="ধরন"
                  className="input"
                  value={newPay.accountType}
                  onChange={(e) => setNewPay({ ...newPay, accountType: e.target.value })}
                >
                  <option value="Personal">Personal</option>
                  <option value="Agent">Agent</option>
                  <option value="Merchant">Merchant</option>
                </select>
              </div>
              <div>
                <label className="label">নির্দেশনা</label>
                <input aria-label="নির্দেশনা"
                  className="input"
                  value={newPay.instruction}
                  onChange={(e) => setNewPay({ ...newPay, instruction: e.target.value })}
                  placeholder="Send Money করুন"
                />
              </div>
            </div>

            <button
              onClick={async () => {
                if (!/^01[3-9]\d{8}$/.test(newPay.accountNo.trim())) {
                  return toast.error('সঠিক মোবাইল নাম্বার দিন');
                }
                const ok = await call('/api/admin/payment', 'POST', newPay, 'নাম্বার যোগ হয়েছে');
                if (ok) {
                  setNewPay({ method: 'BKASH', accountNo: '', accountType: 'Personal', instruction: '' });
                }
              }}
              disabled={busy}
              className="btn-primary"
            >
              নাম্বার যোগ করুন
            </button>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            {payments.map((p: (typeof payments)[number]) => (
              <div key={p.id} className="card p-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-sm font-bold text-slate-900">
                      {p.method}{' '}
                      <span className="text-xs font-normal text-slate-400">({p.accountType})</span>
                    </p>
                    <p className="mt-1 select-all font-mono text-lg font-bold tracking-wide text-emerald-600">
                      {p.accountNo}
                    </p>
                    {p.instruction && (
                      <p className="mt-1 text-xs text-slate-400">{p.instruction}</p>
                    )}
                  </div>

                  <div className="flex shrink-0 gap-1.5">
                    <button
                      disabled={busy}
                      onClick={() =>
                        call(
                          '/api/admin/payment',
                          'PATCH',
                          { id: p.id, isActive: !p.isActive },
                          p.isActive ? 'নাম্বার বন্ধ' : 'নাম্বার চালু'
                        )
                      }
                      className={`badge ${
                        p.isActive
                          ? 'border border-emerald-200 bg-emerald-100 text-emerald-700'
                          : 'border border-slate-200 bg-slate-100 text-slate-400'
                      }`}
                    >
                      {p.isActive ? '●' : '○'}
                    </button>
                    <button
                      disabled={busy}
                      onClick={() => setDelPay(p)}
                      className="btn-danger px-2.5 py-1 text-xs"
                    >
                      🗑
                    </button>
                  </div>
                </div>
              </div>
            ))}
            {payments.length === 0 && (
              <p className="card py-12 text-center text-slate-400 sm:col-span-2">
                কোনো পেমেন্ট নাম্বার নেই — উপরে থেকে যোগ করুন
              </p>
            )}
          </div>
        </div>
      )}

      {/* ── Delete dialogs ── */}
      <ConfirmDialog
        open={Boolean(delSocial)}
        title="সোশ্যাল লিংক মুছে ফেলবেন?"
        confirmLabel="হ্যাঁ, মুছুন"
        danger
        onConfirm={async () => {
          const so = delSocial;
          setDelSocial(null);
          if (so) await call('/api/admin/social', 'DELETE', { id: so.id }, 'লিংক মুছে ফেলা হয়েছে');
        }}
        onCancel={() => setDelSocial(null)}
      />

      <ConfirmDialog
        open={Boolean(delPay)}
        title="পেমেন্ট নাম্বার মুছে ফেলবেন?"
        message="পুরনো ডিপোজিট রেকর্ড অক্ষত থাকবে।"
        confirmLabel="হ্যাঁ, মুছুন"
        danger
        onConfirm={async () => {
          const p = delPay;
          setDelPay(null);
          if (p) await call('/api/admin/payment', 'DELETE', { id: p.id }, 'নাম্বার মুছে ফেলা হয়েছে');
        }}
        onCancel={() => setDelPay(null)}
      />
    </div>
  );
}
