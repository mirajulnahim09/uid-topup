import { getServerSession } from 'next-auth';
import Navbar from '@/components/Navbar';
import Footer from '@/components/Footer';
import MaintenanceScreen from '@/components/MaintenanceScreen';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { getSettings } from '@/lib/settings';

// ★ Maintenance mode এর জন্য প্রতি রিকোয়েস্টে সেটিং/সেশন দেখতে হয়,
//   তাই dynamic। (ছোট সাইটে performance এ প্রভাব নগণ্য।)
export const dynamic = 'force-dynamic';

export default async function PublicLayout({ children }: { children: React.ReactNode }) {
  let siteName = 'UID TopUp';
  let logo: string | null = null;
  let categories: { id: number; name: string }[] = [];
  let maintenance = false;
  let maintenanceMsg = '';

  try {
    const [settings, cats] = await Promise.all([
      getSettings(),
      prisma.category.findMany({
        where: { isActive: true },
        orderBy: { sortOrder: 'asc' },
        select: { id: true, name: true },
      }),
    ]);
    siteName = settings.site_name || siteName;
    logo = settings.site_logo || null;
    categories = cats ?? [];
    maintenance = settings.maintenance_mode === '1';
    maintenanceMsg = settings.maintenance_message || '';
  } catch { /* DB fail হলেও render হবে */ }

  // ★★★ Maintenance mode চালু থাকলে — অ্যাডমিন ছাড়া সবাই maintenance স্ক্রিন দেখবে।
  //     অ্যাডমিন স্বাভাবিকভাবে সাইট দেখতে পারবে (টেস্ট করার জন্য)।
  if (maintenance) {
    const session = await getServerSession(authOptions);
    if (session?.user?.role !== 'ADMIN') {
      return <MaintenanceScreen siteName={siteName} message={maintenanceMsg} />;
    }
  }

  return (
    <div className="flex min-h-screen flex-col">
      <Navbar siteName={siteName} logo={logo} categories={categories} />
      <main id="main" className="flex-1">{children}</main>
      <Footer />
    </div>
  );
}
