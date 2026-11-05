import { getServerSession } from 'next-auth';
import Navbar from '@/components/Navbar';
import Footer from '@/components/Footer';
import MobileTabBar from '@/components/MobileTabBar';
import MaintenanceScreen from '@/components/MaintenanceScreen';
import { resolveBranding, type LogoPair } from '@/lib/branding';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { getSettings } from '@/lib/settings';
import LiveChat from '@/components/LiveChat';

/**
 * ★ গ্রাহক-মুখী সাইট-ক্রোম — নেভবার · ফুটার · বটম-বার · লাইভ চ্যাট,
 *   সাথে maintenance গেট।
 *
 *   ⚠️ এটি আগে `src/app/(public)/layout.tsx` এর **ভেতরে** ছিল, তাই
 *   ক্রোমটি কেবল ঐ route group এর পাতাগুলোই পেত। ফল: রুট-স্তরের
 *   `not-found.tsx` — অর্থাৎ **প্রতিটি ৪০৪** — কোনো নেভবার, ফুটার বা
 *   বটম-বার ছাড়াই রেন্ডার হতো; গ্রাহক পেতেন কেবল দুটি বোতাম।
 *   মাপা: `/product/99999` ও `/__audit-404__` দুটোই হুবহু একই ৯২৮px
 *   খালি পর্দা (২০২৬-০৮-২৯, প্রোডাকশন রিগ)।
 *
 *   কোডটি এখানে সরিয়ে আনায় লেআউট ও ৪০৪ — দুই জায়গাই **একই** ক্রোম
 *   পায়, আর ভবিষ্যতে নেভবার বদলালে দুই জায়গায় বদলাতে হয় না।
 *   `(public)/layout.tsx` এর আচরণ অপরিবর্তিত।
 */
export default async function PublicChrome({ children }: { children: React.ReactNode }) {
  let siteName = 'SS UID TOPUP';
  let logo: string | null = null;
  let brandLogos: LogoPair | undefined;
  let categories: { id: number; name: string }[] = [];
  let maintenance = false;
  let maintenanceMsg = '';
  let tawkProperty: string | undefined;
  let tawkWidget: string | undefined;

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
    brandLogos = resolveBranding(settings).logos.primary;
    categories = cats ?? [];
    maintenance = settings.maintenance_mode === '1';
    maintenanceMsg = settings.maintenance_message || '';
    tawkProperty = settings.tawk_property_id || undefined;
    tawkWidget = settings.tawk_widget_id || undefined;
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
      <Navbar siteName={siteName} logo={logo} brandLogos={brandLogos} categories={categories} />
      <main id="main" className="flex-1">{children}</main>
      <Footer />
      {/* ★ মোবাইল বটম ন্যাভ — শুধু ছোট স্ক্রিনে দেখা যায় */}
      <MobileTabBar />
      {/* ★ লাইভ চ্যাট — অ্যাডমিন Tawk.to আইডি সেট করলে তবেই লোড হয় */}
      <LiveChat propertyId={tawkProperty} widgetId={tawkWidget} />
    </div>
  );
}
