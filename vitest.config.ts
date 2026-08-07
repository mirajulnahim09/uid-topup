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
    pool: 'forks',
    poolOptions: { forks: { singleFork: true } },
    fileParallelism: false,
    testTimeout: 30_000,
    hookTimeout: 30_000,
    reporters: 'verbose',
  },
  resolve: {
    alias: { '@': path.resolve(__dirname, 'src') },
  },
});
