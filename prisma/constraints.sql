-- ═══════════════════════════════════════════════════════════════
-- ⚠️ পুরনো ফাইল (২০২৬-১০-৩১) — আর হাতে চালানোর দরকার নেই
--
-- এই সব constraint এখন মাইগ্রেশনের অংশ, `npm run db:migrate:deploy`
-- চালালেই বসে যায়:
--   · 20260918120000_money_check_constraints — নিচের ৬টি
--   · 20261031130000_refund_withdrawal_checks_adminlog_append_only —
--       order_refund_valid, withdrawal_amount_positive, AdminLog append-only trigger
--
-- প্রোডাকশনে `db:push` ব্যবহার করবেন না (মাইগ্রেশন-ইতিহাস ভেঙে যায়)।
-- Neon-এ হাতে কোনো DDL চালাতে হলে **non-pooler** URL (`DIRECT_URL`)
-- ব্যবহার করুন, `-pooler` URL নয়।
-- লোকাল `db:setup` (db push) ডাটাবেসের জন্য: `npm run db:constraints`।
-- ফাইলটি কেবল রেফারেন্সের জন্য রাখা হলো; চালালেও ক্ষতি নেই (idempotent)।
-- ═══════════════════════════════════════════════════════════════

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

-- ফেরতের মোট অঙ্ক ০ থেকে অর্ডারের দামের মধ্যে
ALTER TABLE "Order" DROP CONSTRAINT IF EXISTS order_refund_valid;
ALTER TABLE "Order" ADD CONSTRAINT order_refund_valid
  CHECK ("refundedAmount" >= 0 AND "refundedAmount" <= price);

-- উইথড্রর পরিমাণ ধনাত্মক
ALTER TABLE "Withdrawal" DROP CONSTRAINT IF EXISTS withdrawal_amount_positive;
ALTER TABLE "Withdrawal" ADD CONSTRAINT withdrawal_amount_positive
  CHECK (amount > 0);

-- ★ অ্যাডমিন লগ কখনো মোছা/বদলানো যাবে না (জবাবদিহির জন্য) — এখন DB
--   trigger দিয়েই আটকানো। দেখুন মাইগ্রেশন
--   20261031130000_refund_withdrawal_checks_adminlog_append_only
