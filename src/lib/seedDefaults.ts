/**
 * ★★★ রিপোতে লেখা **লোকাল-কেবল** seed-ডিফল্ট — একটিই উৎস।
 *
 *   `prisma/seed.ts` লোকাল DB-তে এটি দিয়ে অ্যাডমিন বানায়; অ-লোকাল DB-তে
 *   `ADMIN_PASSWORD` না দিলে থেমে যায়। কিন্তু আগেই তৈরি হয়ে থাকা লাইভ অ্যাডমিন
 *   (মাপা নোট, ২০২৬-০৯-১৭: লাইভ ADMIN এখনো এই পাসওয়ার্ডে, 2FA বন্ধ) কেউ শনাক্ত
 *   করত না। `/api/admin/readiness` এখন এটি মিলিয়ে দেখে ব্লকার তোলে।
 *   ⚠️ এটি গোপন নয় — রিপো যে দেখেছে সে-ই জানে; ঠিক সেজন্যই প্রোডাকশনে থাকা চলবে না।
 */
export const DEFAULT_SEED_ADMIN_EMAIL = 'admin@uidtopup.local';
export const DEFAULT_SEED_ADMIN_PASSWORD = 'Admin@2026Secure';
