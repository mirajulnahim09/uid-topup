-- ═══════════════════════════════════════════════════════════
-- ★ Phase 5 — Order-এ costPrice snapshot (মুনাফা রিপোর্টের জন্য)
--
--   অর্ডারের সময়কার unit cost সংরক্ষণ করে। Variant.costPrice পরে
--   বদলালেও ঐতিহাসিক মুনাফা সঠিক থাকে। additive, default 0 — পুরনো
--   অর্ডার (যেখানে cost জানা নেই) 0 থাকবে, রিপোর্ট তা "অজানা" ধরে।
-- ═══════════════════════════════════════════════════════════
ALTER TABLE "Order" ADD COLUMN IF NOT EXISTS "costPrice" DECIMAL(12,2) NOT NULL DEFAULT 0;
