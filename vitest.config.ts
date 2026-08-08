import { defineConfig } from 'vitest/config';
import path from 'node:path';

/**
 * ★ Vitest — money-পথের ইন্টিগ্রেশন টেস্ট (Group D)
 *
 *   ⚠️ `threads: false` / `singleFork` — টেস্টগুলো **একই** ডাটাবেস
 *   ভাগ করে আর প্রতিটির আগে TRUNCATE হয়। সমান্তরালে চললে একটি
 *   টেস্ট আরেকটির ডেটা মুছে দিত, ফলে ব্যর্থতা এলোমেলো ও অবিশ্বাস্য
 *   হতো। ক্রমিক চালানোই এখানে সঠিক।
 *
 *   ⚠️ `testTimeout` উদার — সমান্তরালতা/লক পরীক্ষা করতে গিয়ে
 *   ইচ্ছাকৃত অপেক্ষা লাগে।
 */
export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    setupFiles: ['./vitest.setup.ts'],
    // ★ একবারই `next dev` চালু হয় ও সব টেস্ট ফাইল সেটি ভাগ করে।
    //   প্রতি ফাইলে সার্ভার চালু করলে রান কয়েক মিনিট দীর্ঘ হতো।
    globalSetup: ['./tests/globalSetup.ts'],
    pool: 'forks',
    poolOptions: { forks: { singleFork: true } },
    fileParallelism: false,
    // ★ HTTP পথ + `next dev`-এর চাহিদামতো compile — প্রথম হিট ধীর,
    //   তাই in-process টেস্টের চেয়ে অনেক উদার timeout।
    testTimeout: 60_000,
    hookTimeout: 120_000,
    reporters: 'verbose',
  },
  resolve: {
    alias: { '@': path.resolve(__dirname, 'src') },
  },
});
