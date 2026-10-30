import { prisma } from '@/lib/prisma';
import { requireUserPage } from '@/lib/pageGuard';
import ProfileEditor from '@/components/ProfileEditor';
import TwoFactorSettings from '@/components/TwoFactorSettings';
import SignOutAllButton from '@/components/SignOutAllButton';
import DeleteAccountSection from '@/components/DeleteAccountSection';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'আমার তথ্য' };

export default async function ProfilePage() {
  // ★ SEC-01 — DB-যাচাই (ban + sessionEpoch), ব্যর্থ হলে লগইনে (আগে ফাঁকা পাতা)
  const me = await requireUserPage();

  const user = await prisma.user.findUnique({
    where: { id: me.id },
    select: { name: true, phone: true, email: true, role: true, deletionRequestedAt: true },
  });
  if (!user) return null;

  return (
    <div className="mx-auto max-w-2xl space-y-5">
      <div>
        <h1 className="lux-text text-2xl font-medium sm:text-[27px]">আমার তথ্য</h1>
        <p className="mt-1.5 text-sm font-light text-slate-500">নাম, নাম্বার ও পাসওয়ার্ড বদলান।</p>
      </div>

      <ProfileEditor name={user.name} phone={user.phone} email={user.email} />

      <TwoFactorSettings />

      <SignOutAllButton />

      {user.role !== 'ADMIN' && (
        <DeleteAccountSection requestedAt={user.deletionRequestedAt?.toISOString() ?? null} />
      )}
    </div>
  );
}
