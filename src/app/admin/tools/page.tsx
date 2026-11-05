import { getSettings } from '@/lib/settings';
import MaintenanceToggle from '@/components/admin/MaintenanceToggle';
import AnnouncementForm from '@/components/admin/AnnouncementForm';
import RestoreForm from '@/components/admin/RestoreForm';
import ReadinessPanel from '@/components/admin/ReadinessPanel';
import { requireAdminPage } from '@/lib/pageGuard';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'টুলস' };

export default async function ToolsPage() {
  // ★ SEC-01 — পাতার নিজস্ব DB-গার্ড (সফট-নেভিগেশনে লেআউট চলে না)
  await requireAdminPage();
  const settings = await getSettings();
  const on = settings.maintenance_mode === '1';
  const msg = settings.maintenance_message || '';

  return (
    <div className="space-y-6">
      <div>
        <h1 className="lux-text text-2xl font-medium sm:text-[27px]">টুলস</h1>
        <p className="mt-1.5 text-sm font-light text-slate-500">ব্যাকআপ ও রক্ষণাবেক্ষণ মোড।</p>
      </div>

      {/* ── Announcement ── */}
      <AnnouncementForm />

      {/* ── সিস্টেম প্রস্তুতি + ফিচার ফ্ল্যাগ ── */}
      <ReadinessPanel />

      {/* ── Maintenance ── */}
      <MaintenanceToggle initialOn={on} initialMsg={msg} />

      {/* ── Backup ── */}
      <div className="card p-5">
        <h2 className="font-bold text-slate-900">ডাটাবেস ব্যাকআপ</h2>
        <p className="mt-1 text-sm text-slate-500">
          পুরো ডাটাবেস একটা JSON ফাইলে ডাউনলোড করুন। নিয়মিত ব্যাকআপ রাখা ভালো।
        </p>
        <div className="mt-3">
          <a href="/api/admin/backup" className="btn-dark" download>
            ⬇️ ব্যাকআপ ডাউনলোড করুন
          </a>
        </div>
        <p className="mt-3 rounded-lg bg-amber-50 p-3 text-xs text-amber-700">
          ⚠️ এই ফাইলে সব তথ্য থাকে (পাসওয়ার্ড হ্যাশসহ)। কাউকে দেবেন না, নিরাপদ জায়গায় রাখুন।
        </p>
      </div>

      {/* ── Restore ── */}
      <RestoreForm />
    </div>
  );
}
