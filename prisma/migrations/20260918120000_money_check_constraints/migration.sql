-- ═══════════════════════════════════════════════════════════════
-- ★★★ টাকার DB-স্তরের রক্ষাকবচ — এখন মাইগ্রেশনে (EXTREME অডিট, ২০২৬-০৯-১৮)
--
--   ⚠️ কেন এই মাইগ্রেশন: গার্ডগুলো এতদিন কেবল `npm run db:constraints`
--   (prisma/constraints.sql) দিয়ে হাতে প্রয়োগ হতো। মাপা: সম্পূর্ণ নতুন
--   ডাটাবেসে `prisma migrate deploy` চালালে CHECK constraint সংখ্যা ছিল
--   **০**, অথচ লাইভে ৬টি — অর্থাৎ DB পুনর্গঠন বা নতুন পরিবেশে (staging,
--   দুর্যোগ-পুনরুদ্ধার) শেষ রক্ষাকবচটি নীরবে অনুপস্থিত থাকত।
--
--   ⚠️ নিরাপত্তা: প্রতিটি constraint **idempotent** (আগে DROP IF EXISTS)।
--   লাইভে এগুলো আগে থেকেই আছে ও কোনো ভাঙা সারি নেই (read-only যাচাই,
--   ২০২৬-০৯-১৮: neg_balance=0, bad_order=0, bad_deposit=0, bad_variant=0,
--   bad_coupon=0) — তাই deploy-এ আচরণ বদলাবে না, কেবল নিশ্চিত হবে।
--
--   উৎস: prisma/constraints.sql (হুবহু একই শর্ত)।
-- ═══════════════════════════════════════════════════════════════

-- দাম কখনো ঋণাত্মক নয়
ALTER TABLE "Variant" DROP CONSTRAINT IF EXISTS variant_price_positive;
ALTER TABLE "Variant" ADD CONSTRAINT variant_price_positive
  CHECK (price >= 0 AND "costPrice" >= 0);

-- স্টক −1 (আনলিমিটেড) এর কম নয়
ALTER TABLE "Variant" DROP CONSTRAINT IF EXISTS variant_stock_valid;
ALTER TABLE "Variant" ADD CONSTRAINT variant_stock_valid
  CHECK (stock >= -1);

-- ★ ব্যালেন্স কখনো ঋণাত্মক নয় — সবচেয়ে জরুরি
ALTER TABLE "User" DROP CONSTRAINT IF EXISTS user_balance_positive;
ALTER TABLE "User" ADD CONSTRAINT user_balance_positive
  CHECK (balance >= 0);

-- অর্ডারের দাম ও ছাড় — ঋণাত্মক নয়, ছাড় subtotal ছাড়ায় না
ALTER TABLE "Order" DROP CONSTRAINT IF EXISTS order_price_valid;
ALTER TABLE "Order" ADD CONSTRAINT order_price_valid
  CHECK (price >= 0 AND discount >= 0 AND subtotal >= 0 AND discount <= subtotal);

-- ডিপোজিটের পরিমাণ ধনাত্মক
ALTER TABLE "Deposit" DROP CONSTRAINT IF EXISTS deposit_amount_positive;
ALTER TABLE "Deposit" ADD CONSTRAINT deposit_amount_positive
  CHECK (amount > 0);

-- কুপনের মান ধনাত্মক, শতকরা ১০০-র বেশি নয়
ALTER TABLE "Coupon" DROP CONSTRAINT IF EXISTS coupon_value_valid;
ALTER TABLE "Coupon" ADD CONSTRAINT coupon_value_valid
  CHECK (
    value > 0
    AND "minOrder" >= 0
    AND "usageCount" >= 0
    AND (type != 'PERCENT' OR value <= 100)
  );
