import Navbar from '@/components/Navbar';
import Footer from '@/components/Footer';
import MobileTabBar from '@/components/MobileTabBar';
import { getSetting } from '@/lib/settings';

export const dynamic = 'force-dynamic';

/** ★ গ্রাহকের ব্যক্তিগত এলাকা — ইনডেক্স নয় (robots.txt-এর পাশাপাশি মেটা-স্তরেও) */
export const metadata = {
  robots: { index: false, follow: false, nocache: true },
};

export default async function AccountLayout({ children }: { children: React.ReactNode }) {
  let siteName = 'SS UID TOPUP';
  try {
    siteName = (await getSetting('site_name')) || siteName;
  } catch {
    /* ignore */
  }

  return (
    <div className="flex min-h-screen flex-col">
      <Navbar siteName={siteName} />
      <main id="main" className="mx-auto w-full max-w-5xl flex-1 page-x page-y">
        {children}
      </main>
      <Footer />
      {/* ★ মোবাইল বটম ন্যাভ — শুধু ছোট স্ক্রিনে */}
      <MobileTabBar />
    </div>
  );
}
