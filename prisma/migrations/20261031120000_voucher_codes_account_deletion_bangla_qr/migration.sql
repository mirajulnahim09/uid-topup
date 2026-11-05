-- Additive only: no existing column or row is changed or dropped.

-- Bangla QR as a manual payment method
ALTER TYPE "PayMethod" ADD VALUE IF NOT EXISTS 'BANGLA_QR';
ALTER TABLE "PaymentChannel" ADD COLUMN IF NOT EXISTS "qrImage" TEXT;

-- Account deletion request
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "deletionRequestedAt" TIMESTAMP(3);
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "deletionReason" TEXT;

-- Product delivery type (TOPUP | CODE)
ALTER TABLE "Product" ADD COLUMN IF NOT EXISTS "deliveryType" TEXT NOT NULL DEFAULT 'TOPUP';

-- Voucher codes
CREATE TYPE "VoucherCodeStatus" AS ENUM ('AVAILABLE', 'ASSIGNED', 'VOID');

CREATE TABLE "VoucherCode" (
    "id" TEXT NOT NULL,
    "variantId" INTEGER NOT NULL,
    "code" TEXT NOT NULL,
    "status" "VoucherCodeStatus" NOT NULL DEFAULT 'AVAILABLE',
    "orderId" TEXT,
    "batch" TEXT,
    "addedById" TEXT,
    "addedByName" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "assignedAt" TIMESTAMP(3),
    CONSTRAINT "VoucherCode_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "VoucherCode_orderId_key" ON "VoucherCode"("orderId");
CREATE UNIQUE INDEX "VoucherCode_variantId_code_key" ON "VoucherCode"("variantId", "code");
CREATE INDEX "VoucherCode_variantId_status_idx" ON "VoucherCode"("variantId", "status");

ALTER TABLE "VoucherCode" ADD CONSTRAINT "VoucherCode_variantId_fkey" FOREIGN KEY ("variantId") REFERENCES "Variant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "VoucherCode" ADD CONSTRAINT "VoucherCode_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- An assigned code must point at an order; an available one must not.
ALTER TABLE "VoucherCode" ADD CONSTRAINT "VoucherCode_assignment_check"
  CHECK (("status" = 'ASSIGNED') = ("orderId" IS NOT NULL));
