-- Phase 2 (product import + SKU mapping) additions to the mapping table.
--
-- Additive columns only, all nullable, no backfill required: existing Phase 1
-- mapping rows keep working and simply have no imported quantity yet.
--
-- externalQuantity / externalQuantityAt let an inventory difference be shown to
-- the seller without re-querying the channel. inventoryConflictAt marks a
-- difference Yukizi deliberately refuses to resolve on its own — nothing
-- overwrites a quantity while it is set. conflictReason records WHY automatic
-- SKU matching could not decide, so the mapping screen can explain itself
-- rather than just saying "conflict".

ALTER TABLE "integration_product_mappings"
  ADD COLUMN "externalQuantity" INTEGER,
  ADD COLUMN "externalQuantityAt" TIMESTAMP(3),
  ADD COLUMN "inventoryConflictAt" TIMESTAMP(3),
  ADD COLUMN "conflictYukiziQuantity" INTEGER,
  ADD COLUMN "conflictReason" TEXT;

-- The mapping screen's default view is "everything needing attention", which
-- is a filter on this column.
CREATE INDEX "integration_product_mappings_inventoryConflictAt_idx"
  ON "integration_product_mappings"("inventoryConflictAt");

-- externalVariantId: NULL -> '' and NOT NULL.
--
-- Postgres treats NULLs as DISTINCT in a unique index, so while this column was
-- nullable the unique constraint (integrationId, externalProductId,
-- externalVariantId) never fired for listings without a variant — every
-- re-import would have inserted a duplicate row for every simple product
-- instead of updating the existing one. An empty string collides properly.
UPDATE "integration_product_mappings" SET "externalVariantId" = '' WHERE "externalVariantId" IS NULL;
ALTER TABLE "integration_product_mappings" ALTER COLUMN "externalVariantId" SET DEFAULT '';
ALTER TABLE "integration_product_mappings" ALTER COLUMN "externalVariantId" SET NOT NULL;
