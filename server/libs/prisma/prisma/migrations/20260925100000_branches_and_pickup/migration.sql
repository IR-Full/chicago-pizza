-- A chain needs somewhere for an order to be made, and a customer who would
-- rather collect it needs somewhere to collect it from. Opening hours move
-- off the global constant at the same time: the whole point of a second
-- branch is that it can keep different hours.

-- CreateEnum
CREATE TYPE "FulfillmentType" AS ENUM ('DELIVERY', 'PICKUP');

-- AlterEnum
-- Opening a branch, and changing its hours, are decisions worth being able to
-- attribute months later.
ALTER TYPE "AdminAction" ADD VALUE 'BRANCH_CREATED';
ALTER TYPE "AdminAction" ADD VALUE 'BRANCH_UPDATED';

-- CreateTable
CREATE TABLE "branches" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "address" TEXT NOT NULL,
    "lat" DOUBLE PRECISION NOT NULL,
    "lng" DOUBLE PRECISION NOT NULL,
    "phone" TEXT NOT NULL,
    "openingHour" INTEGER NOT NULL DEFAULT 10,
    "closingHour" INTEGER NOT NULL DEFAULT 23,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "branches_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "branches_slug_key" ON "branches"("slug");

-- CreateIndex
CREATE INDEX "branches_isActive_sortOrder_idx" ON "branches"("isActive", "sortOrder");

-- AlterTable
-- Nullable, and DELIVERY by default: every order placed before the chain had
-- more than one kitchen was a delivery from the only one there was.
ALTER TABLE "orders" ADD COLUMN "branchId" TEXT,
ADD COLUMN "fulfillment" "FulfillmentType" NOT NULL DEFAULT 'DELIVERY';

-- CreateIndex
CREATE INDEX "orders_branchId_status_idx" ON "orders"("branchId", "status");

-- AddForeignKey
ALTER TABLE "orders" ADD CONSTRAINT "orders_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "branches"("id") ON DELETE SET NULL ON UPDATE CASCADE;
