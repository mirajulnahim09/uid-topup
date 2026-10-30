/**
 * ★★★ UPL-01 — কেবল **আমাদের** Blob স্টোরের হুবহু হোস্ট (`src/lib/blobHost.ts`-এর
 *   একই নিয়ম; CommonJS বলে এখানে আলাদা করে লেখা — বদলালে দুটোই)।
 *   `@vercel/blob` নিজেই storeId = token.split('_')[3] ধরে URL বানায়।
 *   আগে `**.public.blob.vercel-storage.com` — যেকোনো স্টোরের ছবি আমাদের
 *   `/_next/image` প্রসেস করত।
 */
function ownBlobHost() {
  const explicit = (process.env.BLOB_PUBLIC_HOST || '').trim().toLowerCase();
  if (explicit) {
    return /^[a-z0-9]+\.public\.blob\.vercel-storage\.com$/.test(explicit) ? explicit : null;
  }
  const storeId = ((process.env.BLOB_READ_WRITE_TOKEN || '').trim().split('_')[3] || '').toLowerCase();
  return /^[a-z0-9]+$/.test(storeId) ? `${storeId}.public.blob.vercel-storage.com` : null;
}
const BLOB_HOST = ownBlobHost();

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  // ★ Phase 3 — প্রোডাকশন সোর্স-ম্যাপ বন্ধ: ক্লায়েন্ট বান্ডল ছোট ও
  //   সোর্স কোড কম উন্মুক্ত। ডিবাগ দরকার হলে সাময়িক true করা যায়।
  productionBrowserSourceMaps: false,
  experimental: {
    // ★ Phase 3 — বড় লাইব্রেরির শুধু ব্যবহৃত অংশ বান্ডলে ঢোকে
    //   (barrel-file tree-shaking)। framer-motion/lucide/date-fns এর
    //   মতো প্যাকেজে এটি উল্লেখযোগ্য বান্ডল-হ্রাস দেয়। সম্পূর্ণ নিরাপদ —
    //   শুধু import-রেজলিউশন বদলায়, আচরণ নয়।
    optimizePackageImports: ['framer-motion'],
    // ★ SRE — `src/instrumentation.ts` চালু করে (Next 14-এ এখনো experimental)।
    //   সার্ভার-প্রসেসে একবার: unhandled rejection/exception → errorReporter।
    instrumentationHook: true,
  },
  /**
   * ★★★ ব্যবহারকারীর আপলোড করা ফাইলে নিরাপত্তা-হেডার।
   *
   *   `middleware.ts` এর matcher ছবির path (`.png/.gif/…`) বাদ দেয় — দ্রুততার
   *   জন্য ঠিকই — ফলে `/uploads/…` এ `nosniff` পৌঁছাত না (মাপা:
   *   `scripts/verify/upload-security.ts`)। magic-bytes যাচাই আছে, কিন্তু
   *   `GIF89a<html>…` ধরনের polyglot বৈধ GIF হিসেবে পাস করে; তখন এই হেডার
   *   দুটিই নিশ্চিত করে ফাইলটি কখনো পাতা/স্ক্রিপ্ট হয়ে চলবে না।
   *   (লোকাল ড্রাইভার; প্রোডাকশনে Blob নিজের ডোমেইনে পরিবেশন করে।)
   */
  async headers() {
    return [
      {
        source: '/uploads/:path*',
        headers: [
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'Content-Security-Policy', value: "default-src 'none'; img-src 'self'; sandbox" },
        ],
      },
    ];
  },
  images: {
    // ★ next/image ডেলিভারিতে AVIF → WebP → মূল (ব্রাউজার যা সাপোর্ট করে)।
    //   responsive srcset স্বয়ংক্রিয় (thumbnail/medium/large) — deviceSizes/
    //   imageSizes থেকে। ফলে প্রতিটি ছবির অপ্টিমাইজড সংস্করণ চাহিদামতো তৈরি হয়।
    /**
     * ⚠️ AVIF **ইচ্ছাকৃতভাবে বন্ধ** (স্বাধীন অডিট, ২০২৬-০৯-১৮ · মালিকের সিদ্ধান্ত)।
     *   Next 14.2.35 — GHSA-2xp9-vwfh-vxw4: Image Optimization API-তে AVIF ফাইল
     *   ব্যবহারে **unauthenticated RCE** (critical)। প্যাচ কেবল ≥15.5.24-এ, আর
     *   14.x লাইনে কোনো প্যাচ নেই। তালিকা থেকে AVIF সরালে ঐ কোড-পথ আর ব্যবহৃত
     *   হয় না; WebP-তে ছবি সামান্য বড় হয় — নিরাপত্তার তুলনায় নগণ্য।
     *   Next 15-এ আপগ্রেডের পরে চাইলে আবার চালু করা যাবে।
     */
    formats: ['image/webp'],
    deviceSizes: [360, 480, 640, 768, 1024, 1280, 1536],
    imageSizes: [64, 96, 128, 200, 256, 384],
    // ★ UPL-01 — Blob কনফিগার না থাকলে কোনো বাইরের হোস্টই নয়
    remotePatterns: BLOB_HOST ? [{ protocol: 'https', hostname: BLOB_HOST }] : [],
  },
};
module.exports = nextConfig;
