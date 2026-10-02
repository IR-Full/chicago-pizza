-- Interchangeable choices of the same product — the flavour of a drink.
--
-- Kinza is one menu line at one price with six flavours behind it. It was
-- seeded as a single product whose description listed them, so the kitchen
-- received "Kinza" and no way to know which one the customer meant.
--
-- No price column: the menu charges 130 ₽ whichever flavour you pick, and a
-- column nobody fills in misrepresents the data. Add one when a flavour
-- actually costs more.

CREATE TABLE "product_variants" (
    "id" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "product_variants_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "product_variants_productId_slug_key"
    ON "product_variants"("productId", "slug");

ALTER TABLE "product_variants"
    ADD CONSTRAINT "product_variants_productId_fkey"
    FOREIGN KEY ("productId") REFERENCES "products"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

-- The flavour as sold, snapshotted onto the order line beside the product
-- name. An order is a record of what happened: reading the flavour back
-- through `config.variantId` would follow a row that may since have been
-- renamed or deleted.
ALTER TABLE "order_items" ADD COLUMN "variantName" TEXT;
