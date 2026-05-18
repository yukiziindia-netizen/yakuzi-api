/*
  Warnings:

  - Added the required column `updatedAt` to the `product_batches` table without a default value. This is not possible if the table is not empty.

*/
-- CreateEnum
CREATE TYPE "AlertType" AS ENUM ('NEAR_EXPIRY', 'OUT_OF_STOCK');

-- AlterTable: Add updatedAt with default for existing rows, then keep as NOT NULL
ALTER TABLE "product_batches" ADD COLUMN     "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- CreateTable
CREATE TABLE "product_search_index" (
    "id" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "manufacturer" TEXT NOT NULL,
    "chemicalComposition" TEXT NOT NULL,
    "categoryName" TEXT NOT NULL,
    "subCategoryName" TEXT NOT NULL,
    "searchVector" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "product_search_index_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "product_analytics" (
    "id" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "views" INTEGER NOT NULL DEFAULT 0,
    "orders" INTEGER NOT NULL DEFAULT 0,
    "lastViewed" TIMESTAMP(3),
    "lastOrdered" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "product_analytics_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "inventory_alerts" (
    "id" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "batchId" TEXT,
    "alertType" "AlertType" NOT NULL,
    "message" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "inventory_alerts_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "product_search_index_productId_key" ON "product_search_index"("productId");

-- CreateIndex
CREATE INDEX "product_search_index_name_idx" ON "product_search_index"("name");

-- CreateIndex
CREATE INDEX "product_search_index_manufacturer_idx" ON "product_search_index"("manufacturer");

-- CreateIndex
CREATE INDEX "product_search_index_searchVector_idx" ON "product_search_index"("searchVector");

-- CreateIndex
CREATE INDEX "product_search_index_categoryName_idx" ON "product_search_index"("categoryName");

-- CreateIndex
CREATE UNIQUE INDEX "product_analytics_productId_key" ON "product_analytics"("productId");

-- CreateIndex
CREATE INDEX "product_analytics_views_idx" ON "product_analytics"("views");

-- CreateIndex
CREATE INDEX "product_analytics_orders_idx" ON "product_analytics"("orders");

-- CreateIndex
CREATE INDEX "product_analytics_lastViewed_idx" ON "product_analytics"("lastViewed");

-- CreateIndex
CREATE INDEX "inventory_alerts_productId_idx" ON "inventory_alerts"("productId");

-- CreateIndex
CREATE INDEX "inventory_alerts_batchId_idx" ON "inventory_alerts"("batchId");

-- CreateIndex
CREATE INDEX "inventory_alerts_alertType_idx" ON "inventory_alerts"("alertType");

-- CreateIndex
CREATE INDEX "inventory_alerts_createdAt_idx" ON "inventory_alerts"("createdAt");

-- CreateIndex
CREATE INDEX "product_batches_productId_batchNumber_idx" ON "product_batches"("productId", "batchNumber");

-- AddForeignKey
ALTER TABLE "product_search_index" ADD CONSTRAINT "product_search_index_productId_fkey" FOREIGN KEY ("productId") REFERENCES "products"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_analytics" ADD CONSTRAINT "product_analytics_productId_fkey" FOREIGN KEY ("productId") REFERENCES "products"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventory_alerts" ADD CONSTRAINT "inventory_alerts_productId_fkey" FOREIGN KEY ("productId") REFERENCES "products"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventory_alerts" ADD CONSTRAINT "inventory_alerts_batchId_fkey" FOREIGN KEY ("batchId") REFERENCES "product_batches"("id") ON DELETE SET NULL ON UPDATE CASCADE;
