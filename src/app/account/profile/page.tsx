import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import ProfileEditor from '@/components/ProfileEditor';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'আমার তথ্য' };

export default async function ProfilePage() {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) return null;

  const user = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: { name: true, phone: true, email: true },
  });
  if (!user) return null;

  return (
    <div className="mx-auto max-w-lg space-y-5">
      <div>
        <h1 className="text-2xl font-bold text-slate-900">আমার তথ্য</h1>
        <p className="mt-0.5 text-sm text-slate-500">নাম, নাম্বার ও পাসওয়ার্ড বদলান।</p>
      </div>

      <ProfileEditor name={user.name} phone={user.phone} email={user.email} />
    </div>
  );
}
