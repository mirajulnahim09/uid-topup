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
  },
  images: {
    // ★ next/image ডেলিভারিতে AVIF → WebP → মূল (ব্রাউজার যা সাপোর্ট করে)।
    //   responsive srcset স্বয়ংক্রিয় (thumbnail/medium/large) — deviceSizes/
    //   imageSizes থেকে। ফলে প্রতিটি ছবির অপ্টিমাইজড সংস্করণ চাহিদামতো তৈরি হয়।
    formats: ['image/avif', 'image/webp'],
    deviceSizes: [360, 480, 640, 768, 1024, 1280, 1536],
    imageSizes: [64, 96, 128, 200, 256, 384],
    remotePatterns: [
      { protocol: 'https', hostname: '**.public.blob.vercel-storage.com' },
    ],
  },
};
module.exports = nextConfig;
