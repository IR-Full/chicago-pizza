-- Review follow-up migration.
--
-- 1. Drops two columns that were written but never read.
-- 2. Detaches reviews from products: `reviews.productId` was always NULL, so
--    product pages could never show a review.
-- 3. Adds a per-customer promocode limit backed by a redemption ledger.
-- 4. Indexes the foreign keys Postgres does not index on its own, plus the
--    expiry columns the new cleanup job scans.

-- ── 1. Dead columns ───────────────────────────────────────────────────────
-- Login throttling lives in Redis; who invited whom is stored in "referrals".
ALTER TABLE "users" DROP COLUMN "failedLoginCount";
ALTER TABLE "users" DROP COLUMN "referredById";

-- ── 2. A review rates the order, not a single product ─────────────────────
ALTER TABLE "reviews" DROP CONSTRAINT "reviews_productId_fkey";
DROP INDEX "reviews_productId_idx";
ALTER TABLE "reviews" DROP COLUMN "productId";

CREATE INDEX "reviews_userId_idx" ON "reviews"("userId");
CREATE INDEX "reviews_createdAt_idx" ON "reviews"("createdAt");

-- ── 3. Per-customer promocode limit ───────────────────────────────────────
-- NULL = unlimited uses per customer; 1 = the usual "one per account".
ALTER TABLE "promocodes" ADD COLUMN "perUserLimit" INTEGER DEFAULT 1;

CREATE TABLE "promocode_redemptions" (
    "id" TEXT NOT NULL,
    "promocodeId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "promocode_redemptions_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "promocode_redemptions_orderId_key" ON "promocode_redemptions"("orderId");
CREATE INDEX "promocode_redemptions_promocodeId_userId_idx" ON "promocode_redemptions"("promocodeId", "userId");
CREATE INDEX "promocode_redemptions_userId_idx" ON "promocode_redemptions"("userId");

ALTER TABLE "promocode_redemptions" ADD CONSTRAINT "promocode_redemptions_promocodeId_fkey" FOREIGN KEY ("promocodeId") REFERENCES "promocodes"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "promocode_redemptions" ADD CONSTRAINT "promocode_redemptions_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "promocode_redemptions" ADD CONSTRAINT "promocode_redemptions_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Existing orders that carried a promocode count as one redemption each,
-- otherwise every past customer would get a free extra use.
INSERT INTO "promocode_redemptions" ("id", "promocodeId", "userId", "orderId", "createdAt")
SELECT gen_random_uuid()::TEXT, "promocodeId", "userId", "id", "createdAt"
FROM "orders"
WHERE "promocodeId" IS NOT NULL;

-- ── 4. Missing indexes ────────────────────────────────────────────────────
CREATE INDEX "products_categoryId_idx" ON "products"("categoryId");
CREATE INDEX "orders_addressId_idx" ON "orders"("addressId");
CREATE INDEX "orders_courierId_idx" ON "orders"("courierId");
CREATE INDEX "orders_promocodeId_idx" ON "orders"("promocodeId");
CREATE INDEX "order_items_doughTypeId_idx" ON "order_items"("doughTypeId");
CREATE INDEX "loyalty_transactions_orderId_idx" ON "loyalty_transactions"("orderId");
CREATE INDEX "ticket_messages_senderId_idx" ON "ticket_messages"("senderId");
CREATE INDEX "notifications_userId_createdAt_idx" ON "notifications"("userId", "createdAt");

-- Verification looks a code up by (user, hash); the cleanup job scans expiry.
DROP INDEX "email_verification_codes_userId_idx";
CREATE INDEX "email_verification_codes_userId_codeHash_idx" ON "email_verification_codes"("userId", "codeHash");
CREATE INDEX "email_verification_codes_expiresAt_idx" ON "email_verification_codes"("expiresAt");
CREATE INDEX "refresh_tokens_expiresAt_idx" ON "refresh_tokens"("expiresAt");
CREATE INDEX "password_reset_tokens_expiresAt_idx" ON "password_reset_tokens"("expiresAt");
