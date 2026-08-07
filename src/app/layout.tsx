import type { Metadata, Viewport } from 'next';
import { cookies } from 'next/headers';
import './globals.css';
import Providers from '@/components/Providers';
import SiteBackground from '@/components/fx/SiteBackground';
import CustomCursor from '@/components/fx/CustomCursor';
import PWA from '@/components/PWA';
import LoadingStage from '@/components/loading/LoadingStage';
import BootDismiss from '@/components/fx/BootDismiss';
import { ThemeProvider, THEME_INIT_SCRIPT } from '@/components/theme/ThemeProvider';
import { getSettings } from '@/lib/settings';
import { LOCALE_COOKIE, normalizeLocale, translate } from '@/lib/i18n';
import { getBranding, absoluteUrl } from '@/lib/branding';
import { BrandProvider } from '@/components/brand/BrandProvider';

/**
 * ★★★ মেটাডেটা সম্পূর্ণ **অ্যাডমিন-নিয়ন্ত্রিত** (2026-08-05)।
 *
 *   টাইটেল, বিবরণ, কীওয়ার্ড, OG ও আইকন — সবই `/admin/branding`
 *   থেকে আসে। কিছু সেট না থাকলে `branding.ts` সংবেদনশীল ডিফল্টে
 *   পড়ে যায়, তাই নতুন ইনস্টলেও SEO ফাঁকা থাকে না।
 */
export async function generateMetadata(): Promise<Metadata> {
  const b = await getBranding();

  // ★ আপলোড করা ফেভিকন/OG থাকলে সেটিই; নাহলে স্ট্যাটিক `app/icon.svg`
  //   (Next নিজে থেকেই যেটি তুলে নেয়) কার্যকর থাকে।
  const icons = b.logos.favicon.dark
    ? { icon: b.logos.favicon.dark, apple: b.logos.pwa.dark || b.logos.favicon.dark }
    : undefined;

  const ogImage = b.logos.og.dark ? absoluteUrl(b.logos.og.dark, b.siteUrl) : undefined;

  return {
    title: { default: b.metaTitle, template: `%s | ${b.browserTitle}` },
    description: b.metaDescription,
    keywords: b.keywords,
    applicationName: b.siteName,
    ...(icons ? { icons } : {}),
    openGraph: {
      title: b.ogTitle,
      description: b.ogDescription,
      siteName: b.siteName,
      locale: 'bn_BD',
      type: 'website',
      ...(ogImage ? { images: [{ url: ogImage }] } : {}),
    },
    twitter: {
      card: 'summary_large_image',
      title: b.ogTitle,
      description: b.ogDescription,
      ...(ogImage ? { images: [ogImage] } : {}),
    },
    robots: { index: true, follow: true },
  };
}

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  // ♿ maximumScale সেট করা হয় না — pinch-zoom সীমিত করলে WCAG 1.4.4 ভাঙে
  //   ★ ডিফল্ট গাঢ় থিমের সাথে মেলে; ThemeProvider থিম বদলালে এই মেটা
  //     ট্যাগের content ও লাইভ আপডেট করে।
  themeColor: '#0a0b11',
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  // ★ ফিচার ১০ — কুকি থেকে ভাষা পড়ি (ডিফল্ট বাংলা)
  const locale = normalizeLocale(cookies().get(LOCALE_COOKIE)?.value);


  // ★ বুট-পর্দার লোগো — সার্ভারেই রেজলভ করা হয়, কারণ এই মার্কআপ
  //   JS চালু হওয়ার **আগে** দেখা যায়; ক্লায়েন্টে আনলে দেরি হতো।
  //   DB না পেলেও পাতা ভাঙবে না (getBranding নিজে গার্ডেড)।
  const branding = await getBranding();

  // ★ বুট-পর্দার বার্তা সার্ভারেই অনুবাদ করা — এই মার্কআপ JS চালুর
  //   আগেই দেখা যায়, তাই ক্লায়েন্ট-সাইড `useT()` এখানে চলবে না।
  const BOOT_MESSAGES = [
    translate(locale, 'load.rotate1'),
    translate(locale, 'load.rotate2'),
    translate(locale, 'load.rotate3'),
  ];

  return (
    <html lang={locale} suppressHydrationWarning>
      <head>
        {/* ★ ফন্ট preconnect — globals.css এর @import (Google Fonts) শুরু
            হওয়ার আগেই TCP+TLS হ্যান্ডশেক সেরে রাখে, ফলে টেক্সট দ্রুত
            রেন্ডার হয় (display=swap আগে থেকেই আছে)। শুধু hint — কোনো
            ভিজ্যুয়াল/CSP পরিবর্তন নয়। */}
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
      </head>
      <body>
        {/* ★ flash-প্রতিরোধ: প্রথম paint এর আগেই সংরক্ষিত থিম বসায়।
            ★★★ H3 — এখানে ইচ্ছাকৃতভাবে `nonce` **বসানো হয় না**।
            প্রথমে nonce বসানো হয়েছিল, কিন্তু nonce প্রতি-অনুরোধে
            আলাদা হওয়ায় প্রাথমিক HTML ও পরবর্তী RSC রেন্ডারের মান
            মিলত না — React "Prop `nonce` did not match" hydration
            mismatch দিত (dev-এ মাপা)। স্ক্রিপ্টটি **স্থির**, তাই
            middleware তার SHA-256 হ্যাশ CSP-তে বসায়; হ্যাশ প্রতি
            অনুরোধে এক, ফলে mismatch নেই আর নীতিও কড়া থাকে। */}
        <script dangerouslySetInnerHTML={{ __html: THEME_INIT_SCRIPT }} />

        {/* ★★★ বুট-পর্দা — পূর্ণ পৃষ্ঠা লোড/রিলোডের জন্য।
            এটি **সার্ভার-রেন্ডার করা মার্কআপ**, তাই JS চালু হওয়ার
            আগেই দেখা যায় — `LoadingProvider` (React) তখনো চলে না।
            `LoadingStage` নিজে server component ও বিশুদ্ধ CSS (বার্তা
            বদলও CSS-এ), তাই ওভারলে ও বুট-পর্দা **হুবহু একই** দৃশ্য —
            পুরো প্ল্যাটফর্মে একটিই লোডিং ভাষা।
            সরানো হয় `BootDismiss` দিয়ে; CSS-এ ৮ সেকেন্ডের
            safety আছে যাতে JS ব্যর্থ হলেও পর্দা আটকে না থাকে। */}
        <div id="v-boot" aria-hidden="true">
          <LoadingStage size={320} uid="boot" messages={BOOT_MESSAGES} />
        </div>
        {/* ♿ Tab চাপলে প্রথমে আসবে */}
        <a href="#main" className="skip-link">মূল কন্টেন্টে যান</a>
        <ThemeProvider>
          {/* ★ ব্র্যান্ড একবারই সার্ভার থেকে ক্লায়েন্টে — এরপর যেকোনো
              ক্লায়েন্ট কম্পোনেন্ট `useLogo()` দিয়ে লোগো পায়, বাড়তি
              অনুরোধ বা ঝলকানি ছাড়াই। */}
          <BrandProvider value={branding}>
            <SiteBackground />
            <CustomCursor />
            <div className="relative z-10">
              <Providers initialLocale={locale}>
                <BootDismiss />
                {children}
                <PWA />
              </Providers>
            </div>
          </BrandProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
