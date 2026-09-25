-- A flat tariff across a whole city is a promise the kitchen cannot keep
-- evenly: the same 150 ₽ buys a five-minute hop downtown and a half-hour run
-- to the edge of town. A zone carries its own fee and its own minimum, and is
-- a polygon rather than a radius — a circle drawn around a branch promises
-- both sides of a railway line equally.

-- CreateEnum
ALTER TYPE "AdminAction" ADD VALUE 'ZONE_CREATED';
ALTER TYPE "AdminAction" ADD VALUE 'ZONE_UPDATED';

-- CreateTable
CREATE TABLE "delivery_zones" (
    "id" TEXT NOT NULL,
    "branchId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    -- `[[lng, lat], ...]`, GeoJSON's order. Tested in application code rather
    -- than by PostGIS: one extension fewer, for a shop with a few zones.
    "polygon" JSONB NOT NULL,
    "deliveryFee" INTEGER NOT NULL,
    "minOrderAmount" INTEGER NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "delivery_zones_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "delivery_zones_isActive_sortOrder_idx" ON "delivery_zones"("isActive", "sortOrder");

-- CreateIndex
CREATE INDEX "delivery_zones_branchId_idx" ON "delivery_zones"("branchId");

-- AddForeignKey
ALTER TABLE "delivery_zones" ADD CONSTRAINT "delivery_zones_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "branches"("id") ON DELETE CASCADE ON UPDATE CASCADE;
