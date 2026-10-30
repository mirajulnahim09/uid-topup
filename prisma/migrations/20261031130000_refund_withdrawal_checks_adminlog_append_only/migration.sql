-- ═══════════════════════════════════════════════════════════════
-- Extra DB-level guards (2026-10-31)
--
-- 1. Order.refundedAmount stays between 0 and the order price.
--    The partial-refund rule (`refundedAmount + amount <= price`) was
--    enforced only in app code; now the database refuses it too.
-- 2. Withdrawal.amount must be positive.
-- 3. AdminLog is append-only: UPDATE and DELETE are rejected.
--
-- If existing rows violate 1 or 2, this migration fails and rolls back
-- without changing anything — fix those rows first (see the SELECTs at
-- the end of this file).
-- ═══════════════════════════════════════════════════════════════

-- 1 ─ refunds can never exceed what was paid
ALTER TABLE "Order" DROP CONSTRAINT IF EXISTS order_refund_valid;
ALTER TABLE "Order" ADD CONSTRAINT order_refund_valid
  CHECK ("refundedAmount" >= 0 AND "refundedAmount" <= price);

-- 2 ─ a withdrawal is always a positive amount
ALTER TABLE "Withdrawal" DROP CONSTRAINT IF EXISTS withdrawal_amount_positive;
ALTER TABLE "Withdrawal" ADD CONSTRAINT withdrawal_amount_positive
  CHECK (amount > 0);

-- 3 ─ audit log is append-only
--   Escape hatch for a deliberate, documented purge (e.g. legal retention
--   or cleaning a throw-away dev copy), inside one transaction:
--     BEGIN;
--     SET LOCAL app.allow_adminlog_purge = 'on';
--     DELETE FROM "AdminLog" WHERE ...;
--     COMMIT;
--   The setting is LOCAL, so it ends with that transaction.
CREATE OR REPLACE FUNCTION adminlog_append_only() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' AND current_setting('app.allow_adminlog_purge', true) = 'on' THEN
    RETURN OLD;
  END IF;
  RAISE EXCEPTION 'AdminLog is append-only (% blocked)', TG_OP
    USING ERRCODE = 'insufficient_privilege';
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS adminlog_no_update ON "AdminLog";
CREATE TRIGGER adminlog_no_update
  BEFORE UPDATE ON "AdminLog"
  FOR EACH ROW EXECUTE FUNCTION adminlog_append_only();

DROP TRIGGER IF EXISTS adminlog_no_delete ON "AdminLog";
CREATE TRIGGER adminlog_no_delete
  BEFORE DELETE ON "AdminLog"
  FOR EACH ROW EXECUTE FUNCTION adminlog_append_only();

-- TRUNCATE skips row triggers, so it gets its own statement-level guard.
CREATE OR REPLACE FUNCTION adminlog_no_truncate() RETURNS trigger AS $$
BEGIN
  IF current_setting('app.allow_adminlog_purge', true) = 'on' THEN
    RETURN NULL;
  END IF;
  RAISE EXCEPTION 'AdminLog is append-only (TRUNCATE blocked)'
    USING ERRCODE = 'insufficient_privilege';
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS adminlog_no_truncate ON "AdminLog";
CREATE TRIGGER adminlog_no_truncate
  BEFORE TRUNCATE ON "AdminLog"
  FOR EACH STATEMENT EXECUTE FUNCTION adminlog_no_truncate();

-- Pre-flight checks (run by hand before deploying; each should return 0):
--   SELECT COUNT(*) FROM "Order" WHERE "refundedAmount" < 0 OR "refundedAmount" > price;
--   SELECT COUNT(*) FROM "Withdrawal" WHERE amount <= 0;
