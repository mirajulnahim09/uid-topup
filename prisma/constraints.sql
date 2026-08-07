-- ═══════════════════════════════════════════════════════════════
-- ★ DB-LEVEL গার্ড — শেষ রক্ষাকবচ
--
-- অ্যাপে guard আছে, কিন্তু যদি কেউ ম্যানুয়ালি SQL চালায়, বা
-- ভবিষ্যতে কোনো বাগ ঢোকে — তাহলেও ডাটাবেস নিজেই আটকাবে।
--
-- চালানোর নিয়ম (একবার, npm run db:push এর পর):
--   psql "$DATABASE_URL" -f prisma/constraints.sql
-- ═══════════════════════════════════════════════════════════════

-- দাম কখনো negative হবে না
ALTER TABLE "Variant" DROP CONSTRAINT IF EXISTS variant_price_positive;
ALTER TABLE "Variant" ADD CONSTRAINT variant_price_positive
  CHECK (price >= 0 AND "costPrice" >= 0);

-- স্টক −1 (আনলিমিটেড) এর কম হবে না
ALTER TABLE "Variant" DROP CONSTRAINT IF EXISTS variant_stock_valid;
ALTER TABLE "Variant" ADD CONSTRAINT variant_stock_valid
  CHECK (stock >= -1);

-- ★ ব্যালেন্স কখনো negative হবে না — সবচেয়ে জরুরি
ALTER TABLE "User" DROP CONSTRAINT IF EXISTS user_balance_positive;
ALTER TABLE "User" ADD CONSTRAINT user_balance_positive
  CHECK (balance >= 0);

-- অর্ডারের দাম ও ছাড় — negative নয়, ছাড় subtotal ছাড়াবে না
ALTER TABLE "Order" DROP CONSTRAINT IF EXISTS order_price_valid;
ALTER TABLE "Order" ADD CONSTRAINT order_price_valid
  CHECK (price >= 0 AND discount >= 0 AND subtotal >= 0 AND discount <= subtotal);

-- ডিপোজিটের পরিমাণ ধনাত্মক
ALTER TABLE "Deposit" DROP CONSTRAINT IF EXISTS deposit_amount_positive;
ALTER TABLE "Deposit" ADD CONSTRAINT deposit_amount_positive
  CHECK (amount > 0);

-- কুপনের মান ধনাত্মক, শতকরা ১০০ এর বেশি নয়
ALTER TABLE "Coupon" DROP CONSTRAINT IF EXISTS coupon_value_valid;
ALTER TABLE "Coupon" ADD CONSTRAINT coupon_value_valid
  CHECK (
    value > 0
    AND "minOrder" >= 0
    AND "usageCount" >= 0
    AND (type != 'PERCENT' OR value <= 100)
  );

-- ★ অ্যাডমিন লগ কখনো মোছা/বদলানো যাবে না (জবাবদিহির জন্য)
--   (Postgres এ সরাসরি সম্ভব নয়, তবে অ্যাপে DELETE/UPDATE নেই)
