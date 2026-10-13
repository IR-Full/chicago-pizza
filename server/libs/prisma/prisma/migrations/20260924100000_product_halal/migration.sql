-- Halal is not a decoration on a menu in Makhachkala: for a large share of
-- customers it is the first thing they filter by, and "probably" is not an
-- answer. Default false so nothing claims to be halal until someone says so.

-- AlterTable
ALTER TABLE "products" ADD COLUMN "isHalal" BOOLEAN NOT NULL DEFAULT false;

-- CreateIndex
CREATE INDEX "products_isHalal_idx" ON "products"("isHalal");
