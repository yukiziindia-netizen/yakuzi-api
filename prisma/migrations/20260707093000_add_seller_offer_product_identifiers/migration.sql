ALTER TABLE "seller_offers"
  ADD COLUMN "sku" TEXT,
  ADD COLUMN "serialNo" TEXT,
  ADD COLUMN "specifications" TEXT;

CREATE INDEX "seller_offers_sku_idx" ON "seller_offers"("sku");
CREATE INDEX "seller_offers_serialNo_idx" ON "seller_offers"("serialNo");
