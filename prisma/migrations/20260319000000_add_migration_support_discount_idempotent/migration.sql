-- CreateEnum
CREATE TYPE "DiscountType" AS ENUM ('PTR_DISCOUNT', 'SAME_PRODUCT_BONUS', 'PTR_PLUS_SAME_PRODUCT_BONUS', 'DIFFERENT_PRODUCT_BONUS', 'PTR_PLUS_DIFFERENT_PRODUCT_BONUS');

-- AlterTable: Add new columns to products
ALTER TABLE "products" ADD COLUMN "slug" TEXT;
ALTER TABLE "products" ADD COLUMN "externalId" TEXT;
ALTER TABLE "products" ADD COLUMN "discountType" "DiscountType";
ALTER TABLE "products" ADD COLUMN "discountMeta" JSONB;

-- CreateIndex: unique slug
CREATE UNIQUE INDEX "products_slug_key" ON "products"("slug");

-- CreateIndex: unique externalId
CREATE UNIQUE INDEX "products_externalId_key" ON "products"("externalId");

-- CreateIndex: externalId lookup
CREATE INDEX "products_externalId_idx" ON "products"("externalId");

-- AddUniqueConstraint: composite unique on sub_categories (name + categoryId)
CREATE UNIQUE INDEX "sub_categories_name_categoryId_key" ON "sub_categories"("name", "categoryId");
