import type { Metadata, Viewport } from 'next';
import './globals.css';
import Providers from '@/components/Providers';
import SiteBackground from '@/components/fx/SiteBackground';
import CustomCursor from '@/components/fx/CustomCursor';
import { getSettings } from '@/lib/settings';

export async function generateMetadata(): Promise<Metadata> {
  let name = 'UID TopUp';
  try {
    const s = await getSettings();
    name = s.site_name || name;
  } catch {
    // DB না থাকলেও build ভাঙবে না
  }

  return {
    title: {
      default: `${name} | ফ্রি ফায়ার ডায়মন্ড টপ আপ`,
      template: `%s | ${name}`,
    },
    description: 'ফ্রি ফায়ার ডায়মন্ড টপ আপ — কম দামে ভালো সার্ভিস। bKash / Nagad এ পেমেন্ট করে ১০ সেকেন্ডে সরাসরি অ্যাকাউন্টে ডায়মন্ড। ২৪/৭ সাপোর্ট।',
    keywords: ['ফ্রি ফায়ার টপ আপ', 'Free Fire diamond', 'UID top up', 'bKash Nagad top up', 'ডায়মন্ড কেনা', 'Bangladesh game top up'],
    applicationName: name,
    openGraph: {
      title: `${name} | ফ্রি ফায়ার ডায়মন্ড টপ আপ`,
      description: 'কম দামে ভালো সার্ভিস — ১০ সেকেন্ডে ডায়মন্ড ডেলিভারি। bKash / Nagad।',
      siteName: name,
      locale: 'bn_BD',
      type: 'website',
    },
    twitter: { card: 'summary_large_image', title: `${name} — ফ্রি ফায়ার টপ আপ` },
    robots: { index: true, follow: true },
  };
}

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  // ♿ maximumScale সেট করা হয় না — pinch-zoom সীমিত করলে WCAG 1.4.4 ভাঙে
  themeColor: '#070512',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="bn" suppressHydrationWarning>
      <body>
        {/* ♿ Tab চাপলে প্রথমে আসবে */}
        <a href="#main" className="skip-link">মূল কন্টেন্টে যান</a>
        <SiteBackground />
        <CustomCursor />
        <div className="relative z-10">
          <Providers>{children}</Providers>
        </div>
      </body>
    </html>
  );
}
