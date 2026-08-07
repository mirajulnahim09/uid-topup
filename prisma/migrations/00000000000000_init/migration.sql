-- ═══════════════════════════════════════════════════════════════════
-- ★★★ BASELINE INIT MIGRATION — সম্পূর্ণ schema (২৭ model · ১২ enum)
--
--   কেন এই ফাইল: আগে প্রজেক্ট `prisma db push` দিয়ে চলত — কোনো
--   migration history ছিল না, তাই fresh database-এ `prisma migrate
--   deploy` পুরো schema বানাতে পারত না (শুধু একটা orphan ALTER ছিল)।
--   এই baseline সেই সম্পূর্ণ প্রারম্ভিক অবস্থা ধরে।
--
--   ⚠️ বিদ্যমান (production) DB-তে এটি চালানোর আগে baseline mark করুন:
--        prisma migrate resolve --applied 00000000000000_init
--        prisma migrate resolve --applied 20260728034227_review_photo_url
--      বিস্তারিত MANUAL_PRO.md → "Migration Baseline" অংশে।
--
--   ⚠️ এই ফাইলে `review_photo_url` migration-এর `photoUrl` কলাম
--      ইতিমধ্যে অন্তর্ভুক্ত (Review টেবিলে) — কারণ baseline বর্তমান
--      schema-র পূর্ণ রূপ ধরে। পরের migration সেটিতে idempotent।
-- ═══════════════════════════════════════════════════════════════════

-- CreateEnum
CREATE TYPE "UserStatus" AS ENUM ('ACTIVE', 'SUSPENDED', 'BLOCKED');
CREATE TYPE "Role" AS ENUM ('USER', 'ADMIN');
CREATE TYPE "MediaType" AS ENUM ('IMAGE');
CREATE TYPE "PayMethod" AS ENUM ('BKASH', 'NAGAD', 'ROCKET', 'UPAY');
CREATE TYPE "DiscountType" AS ENUM ('PERCENT', 'FIXED');
CREATE TYPE "DepositStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED');
CREATE TYPE "OrderStatus" AS ENUM ('AWAITING_PAYMENT', 'PENDING', 'PROCESSING', 'COMPLETED', 'FAILED', 'REFUNDED');
CREATE TYPE "OrderActorType" AS ENUM ('SYSTEM', 'ADMIN', 'CUSTOMER');
CREATE TYPE "DepositIntent" AS ENUM ('WALLET_TOPUP', 'ORDER_PAYMENT');
CREATE TYPE "DepositRejectReason" AS ENUM ('TRX_NOT_FOUND', 'AMOUNT_MISMATCH', 'DUPLICATE_TRX', 'UNCLEAR_PROOF', 'WRONG_ACCOUNT', 'OTHER');
CREATE TYPE "OrderFailReason" AS ENUM ('INVALID_UID', 'OUT_OF_STOCK', 'GAME_SERVER_ISSUE', 'PRICE_CHANGED', 'CUSTOMER_REQUEST', 'OTHER');
CREATE TYPE "LedgerType" AS ENUM ('DEPOSIT', 'ORDER', 'REFUND', 'ADMIN_ADJUST', 'REFERRAL_BONUS');

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "password" TEXT NOT NULL,
    "role" "Role" NOT NULL DEFAULT 'USER',
    "balance" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "isBanned" BOOLEAN NOT NULL DEFAULT false,
    "status" "UserStatus" NOT NULL DEFAULT 'ACTIVE',
    "emailVerified" BOOLEAN NOT NULL DEFAULT false,
    "referralCode" TEXT NOT NULL,
    "referredById" TEXT,
    "referralBonusPaid" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "RateLimitBucket" (
    "key" TEXT NOT NULL,
    "count" INTEGER NOT NULL,
    "resetAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "RateLimitBucket_pkey" PRIMARY KEY ("key")
);

CREATE TABLE "Category" (
    "id" SERIAL NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "icon" TEXT,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    CONSTRAINT "Category_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "Product" (
    "id" SERIAL NOT NULL,
    "categoryId" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "image" TEXT,
    "thumbnail" TEXT,
    "banner" TEXT,
    "description" TEXT,
    "needsUid" BOOLEAN NOT NULL DEFAULT true,
    "uidLabel" TEXT NOT NULL DEFAULT 'Player UID',
    "uidHint" TEXT,
    "uidValidationProvider" TEXT,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Product_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ProductImage" (
    "id" SERIAL NOT NULL,
    "productId" INTEGER NOT NULL,
    "url" TEXT NOT NULL,
    "alt" TEXT,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ProductImage_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "Media" (
    "id" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "key" TEXT,
    "storage" TEXT NOT NULL DEFAULT 'blob',
    "folder" TEXT NOT NULL DEFAULT 'site',
    "type" "MediaType" NOT NULL DEFAULT 'IMAGE',
    "mime" TEXT NOT NULL,
    "bytes" INTEGER NOT NULL DEFAULT 0,
    "width" INTEGER,
    "height" INTEGER,
    "alt" TEXT,
    "title" TEXT,
    "description" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "Media_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "Variant" (
    "id" SERIAL NOT NULL,
    "productId" INTEGER NOT NULL,
    "label" TEXT NOT NULL,
    "price" DECIMAL(12,2) NOT NULL,
    "costPrice" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "oldPrice" DECIMAL(12,2),
    "stock" INTEGER NOT NULL DEFAULT -1,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "isPopular" BOOLEAN NOT NULL DEFAULT false,
    "deliveryMinutes" INTEGER,
    CONSTRAINT "Variant_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "Banner" (
    "id" SERIAL NOT NULL,
    "image" TEXT NOT NULL,
    "title" TEXT,
    "subtitle" TEXT,
    "link" TEXT,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Banner_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "Campaign" (
    "id" SERIAL NOT NULL,
    "placement" TEXT NOT NULL DEFAULT 'SLIDER',
    "kind" TEXT NOT NULL DEFAULT 'PROMO',
    "title" TEXT,
    "subtitle" TEXT,
    "imageUrl" TEXT,
    "ctaLabel" TEXT,
    "ctaLink" TEXT,
    "badge" TEXT,
    "dismissible" BOOLEAN NOT NULL DEFAULT true,
    "frequency" TEXT NOT NULL DEFAULT 'once',
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "startsAt" TIMESTAMP(3),
    "endsAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "Campaign_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "SocialLink" (
    "id" SERIAL NOT NULL,
    "platform" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "label" TEXT,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    CONSTRAINT "SocialLink_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "PaymentChannel" (
    "id" SERIAL NOT NULL,
    "method" "PayMethod" NOT NULL,
    "accountNo" TEXT NOT NULL,
    "accountType" TEXT NOT NULL DEFAULT 'Personal',
    "instruction" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    CONSTRAINT "PaymentChannel_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "Coupon" (
    "id" SERIAL NOT NULL,
    "code" TEXT NOT NULL,
    "type" "DiscountType" NOT NULL,
    "value" DECIMAL(12,2) NOT NULL,
    "minOrder" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "maxDiscount" DECIMAL(12,2),
    "usageLimit" INTEGER,
    "usageCount" INTEGER NOT NULL DEFAULT 0,
    "perUserLimit" INTEGER NOT NULL DEFAULT 1,
    "startsAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3),
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Coupon_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "CouponUse" (
    "id" TEXT NOT NULL,
    "couponId" INTEGER NOT NULL,
    "userId" TEXT NOT NULL,
    "orderId" TEXT,
    "discount" DECIMAL(12,2) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "CouponUse_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "Deposit" (
    "id" TEXT NOT NULL,
    "depositNo" SERIAL NOT NULL,
    "userId" TEXT NOT NULL,
    "method" "PayMethod" NOT NULL,
    "amount" DECIMAL(12,2) NOT NULL,
    "trxId" TEXT NOT NULL,
    "senderNo" TEXT NOT NULL,
    "screenshot" TEXT,
    "status" "DepositStatus" NOT NULL DEFAULT 'PENDING',
    "adminNote" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "reviewedAt" TIMESTAMP(3),
    "intent" "DepositIntent" NOT NULL DEFAULT 'WALLET_TOPUP',
    "linkedOrderId" TEXT,
    "rejectReason" "DepositRejectReason",
    CONSTRAINT "Deposit_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "Order" (
    "id" TEXT NOT NULL,
    "orderNo" SERIAL NOT NULL,
    "userId" TEXT NOT NULL,
    "variantId" INTEGER NOT NULL,
    "playerUid" TEXT NOT NULL,
    "playerName" TEXT,
    "subtotal" DECIMAL(12,2) NOT NULL,
    "discount" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "price" DECIMAL(12,2) NOT NULL,
    "productName" TEXT NOT NULL,
    "variantName" TEXT NOT NULL,
    "couponId" INTEGER,
    "status" "OrderStatus" NOT NULL DEFAULT 'PENDING',
    "adminNote" TEXT,
    "internalNote" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),
    "slaDueAt" TIMESTAMP(3),
    "verifiedPlayerName" TEXT,
    "failReason" "OrderFailReason",
    "deliveryConfirmedAt" TIMESTAMP(3),
    "deliveryDisputedAt" TIMESTAMP(3),
    "trackToken" TEXT,
    "claimedById" TEXT,
    "claimedByName" TEXT,
    "claimedAt" TIMESTAMP(3),
    "refundedAmount" DECIMAL(12,2) NOT NULL DEFAULT 0,
    CONSTRAINT "Order_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "OrderEvent" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "status" "OrderStatus" NOT NULL,
    "note" TEXT,
    "actorType" "OrderActorType" NOT NULL DEFAULT 'SYSTEM',
    "actorId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "OrderEvent_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "Review" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "rating" INTEGER NOT NULL,
    "body" TEXT,
    "photoUrl" TEXT,
    "isPublished" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Review_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "TrustMetric" (
    "key" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "computedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "TrustMetric_pkey" PRIMARY KEY ("key")
);

CREATE TABLE "UidLookupCache" (
    "id" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "uid" TEXT NOT NULL,
    "playerName" TEXT NOT NULL,
    "checkedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "UidLookupCache_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "LedgerEntry" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "type" "LedgerType" NOT NULL,
    "amount" DECIMAL(12,2) NOT NULL,
    "balanceAfter" DECIMAL(12,2) NOT NULL,
    "refId" TEXT,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "LedgerEntry_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "Notification" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "link" TEXT,
    "isRead" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Notification_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "Setting" (
    "key" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    CONSTRAINT "Setting_pkey" PRIMARY KEY ("key")
);

CREATE TABLE "AdminLog" (
    "id" TEXT NOT NULL,
    "adminId" TEXT NOT NULL,
    "adminName" TEXT NOT NULL,
    "actorType" TEXT NOT NULL DEFAULT 'ADMIN',
    "role" TEXT,
    "action" TEXT NOT NULL,
    "targetId" TEXT,
    "amount" DECIMAL(12,2),
    "detail" TEXT,
    "ip" TEXT,
    "userAgent" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "AdminLog_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "TelegramMessageLog" (
    "id" TEXT NOT NULL,
    "botId" TEXT NOT NULL,
    "event" TEXT,
    "ok" BOOLEAN NOT NULL,
    "status" INTEGER,
    "latencyMs" INTEGER NOT NULL DEFAULT 0,
    "attempts" INTEGER NOT NULL DEFAULT 1,
    "bytes" INTEGER NOT NULL DEFAULT 0,
    "error" TEXT,
    "response" TEXT,
    "trigger" TEXT NOT NULL DEFAULT 'EVENT',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "TelegramMessageLog_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "TelegramJob" (
    "key" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "description" TEXT,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "status" TEXT NOT NULL DEFAULT 'IDLE',
    "kind" TEXT NOT NULL DEFAULT 'DAILY',
    "atHour" INTEGER NOT NULL DEFAULT 9,
    "atMinute" INTEGER NOT NULL DEFAULT 0,
    "weekday" INTEGER,
    "dayOfMonth" INTEGER,
    "timezone" TEXT NOT NULL DEFAULT 'Asia/Dhaka',
    "runOnceAt" TIMESTAMP(3),
    "botId" TEXT,
    "templateKey" TEXT,
    "nextRunAt" TIMESTAMP(3),
    "lastRunAt" TIMESTAMP(3),
    "lastStatus" TEXT,
    "lastError" TEXT,
    "lastMs" INTEGER,
    "runCount" INTEGER NOT NULL DEFAULT 0,
    "failCount" INTEGER NOT NULL DEFAULT 0,
    "totalMs" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "TelegramJob_pkey" PRIMARY KEY ("key")
);

CREATE TABLE "TelegramJobRun" (
    "id" TEXT NOT NULL,
    "jobKey" TEXT NOT NULL,
    "trigger" TEXT NOT NULL DEFAULT 'SCHEDULE',
    "status" TEXT NOT NULL DEFAULT 'RUNNING',
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),
    "ms" INTEGER,
    "detail" TEXT,
    "error" TEXT,
    CONSTRAINT "TelegramJobRun_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "TelegramTemplate" (
    "key" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "TelegramTemplate_pkey" PRIMARY KEY ("key")
);

-- CreateIndex (unique)
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");
CREATE UNIQUE INDEX "User_phone_key" ON "User"("phone");
CREATE UNIQUE INDEX "User_referralCode_key" ON "User"("referralCode");
CREATE INDEX "User_createdAt_idx" ON "User"("createdAt");
CREATE INDEX "User_referredById_idx" ON "User"("referredById");

CREATE INDEX "RateLimitBucket_resetAt_idx" ON "RateLimitBucket"("resetAt");

CREATE UNIQUE INDEX "Category_slug_key" ON "Category"("slug");

CREATE INDEX "Product_categoryId_idx" ON "Product"("categoryId");
CREATE INDEX "Product_isActive_idx" ON "Product"("isActive");

CREATE INDEX "ProductImage_productId_sortOrder_idx" ON "ProductImage"("productId", "sortOrder");

CREATE UNIQUE INDEX "Media_url_key" ON "Media"("url");
CREATE INDEX "Media_folder_createdAt_idx" ON "Media"("folder", "createdAt");
CREATE INDEX "Media_type_createdAt_idx" ON "Media"("type", "createdAt");

CREATE INDEX "Variant_productId_idx" ON "Variant"("productId");

CREATE INDEX "Campaign_placement_isActive_sortOrder_idx" ON "Campaign"("placement", "isActive", "sortOrder");

CREATE UNIQUE INDEX "Coupon_code_key" ON "Coupon"("code");
CREATE INDEX "Coupon_code_isActive_idx" ON "Coupon"("code", "isActive");

CREATE INDEX "CouponUse_couponId_userId_idx" ON "CouponUse"("couponId", "userId");

CREATE UNIQUE INDEX "Deposit_depositNo_key" ON "Deposit"("depositNo");
CREATE UNIQUE INDEX "Deposit_trxId_key" ON "Deposit"("trxId");
CREATE INDEX "Deposit_userId_idx" ON "Deposit"("userId");
CREATE INDEX "Deposit_status_createdAt_idx" ON "Deposit"("status", "createdAt");
CREATE INDEX "Deposit_linkedOrderId_idx" ON "Deposit"("linkedOrderId");

CREATE UNIQUE INDEX "Order_orderNo_key" ON "Order"("orderNo");
CREATE UNIQUE INDEX "Order_trackToken_key" ON "Order"("trackToken");
CREATE INDEX "Order_userId_idx" ON "Order"("userId");
CREATE INDEX "Order_status_createdAt_idx" ON "Order"("status", "createdAt");

CREATE INDEX "OrderEvent_orderId_createdAt_idx" ON "OrderEvent"("orderId", "createdAt");

CREATE UNIQUE INDEX "Review_orderId_key" ON "Review"("orderId");
CREATE INDEX "Review_isPublished_createdAt_idx" ON "Review"("isPublished", "createdAt");
CREATE INDEX "Review_userId_idx" ON "Review"("userId");

CREATE UNIQUE INDEX "UidLookupCache_provider_uid_key" ON "UidLookupCache"("provider", "uid");
CREATE INDEX "UidLookupCache_checkedAt_idx" ON "UidLookupCache"("checkedAt");

CREATE INDEX "LedgerEntry_userId_createdAt_idx" ON "LedgerEntry"("userId", "createdAt");

CREATE INDEX "Notification_userId_isRead_idx" ON "Notification"("userId", "isRead");

CREATE INDEX "AdminLog_adminId_createdAt_idx" ON "AdminLog"("adminId", "createdAt");
CREATE INDEX "AdminLog_action_createdAt_idx" ON "AdminLog"("action", "createdAt");
CREATE INDEX "AdminLog_actorType_createdAt_idx" ON "AdminLog"("actorType", "createdAt");

CREATE INDEX "TelegramMessageLog_createdAt_idx" ON "TelegramMessageLog"("createdAt");
CREATE INDEX "TelegramMessageLog_botId_createdAt_idx" ON "TelegramMessageLog"("botId", "createdAt");
CREATE INDEX "TelegramMessageLog_ok_createdAt_idx" ON "TelegramMessageLog"("ok", "createdAt");

CREATE INDEX "TelegramJob_enabled_nextRunAt_idx" ON "TelegramJob"("enabled", "nextRunAt");

CREATE INDEX "TelegramJobRun_jobKey_startedAt_idx" ON "TelegramJobRun"("jobKey", "startedAt");
CREATE INDEX "TelegramJobRun_status_startedAt_idx" ON "TelegramJobRun"("status", "startedAt");

-- AddForeignKey
ALTER TABLE "User" ADD CONSTRAINT "User_referredById_fkey" FOREIGN KEY ("referredById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Product" ADD CONSTRAINT "Product_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "Category"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ProductImage" ADD CONSTRAINT "ProductImage_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Variant" ADD CONSTRAINT "Variant_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CouponUse" ADD CONSTRAINT "CouponUse_couponId_fkey" FOREIGN KEY ("couponId") REFERENCES "Coupon"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CouponUse" ADD CONSTRAINT "CouponUse_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Deposit" ADD CONSTRAINT "Deposit_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Order" ADD CONSTRAINT "Order_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Order" ADD CONSTRAINT "Order_variantId_fkey" FOREIGN KEY ("variantId") REFERENCES "Variant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Order" ADD CONSTRAINT "Order_couponId_fkey" FOREIGN KEY ("couponId") REFERENCES "Coupon"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "OrderEvent" ADD CONSTRAINT "OrderEvent_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Review" ADD CONSTRAINT "Review_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Review" ADD CONSTRAINT "Review_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "LedgerEntry" ADD CONSTRAINT "LedgerEntry_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Notification" ADD CONSTRAINT "Notification_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "TelegramJobRun" ADD CONSTRAINT "TelegramJobRun_jobKey_fkey" FOREIGN KEY ("jobKey") REFERENCES "TelegramJob"("key") ON DELETE CASCADE ON UPDATE CASCADE;
