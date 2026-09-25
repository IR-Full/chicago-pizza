-- A kitchen that runs out of dough at nine in the evening needs to take a
-- pizza off the menu *for tonight*. The only tool it had was `isActive`,
-- which is permanent — so items got delisted and nobody remembered to bring
-- them back.

-- AlterEnum
ALTER TYPE "AdminAction" ADD VALUE 'PRODUCT_STOPPED';
ALTER TYPE "AdminAction" ADD VALUE 'PRODUCT_RESUMED';

-- AlterTable
ALTER TABLE "products" ADD COLUMN "stoppedUntil" TIMESTAMP(3);

-- CreateIndex
CREATE INDEX "products_stoppedUntil_idx" ON "products"("stoppedUntil");
