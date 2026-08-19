-- AlterTable
ALTER TABLE "orders" ADD COLUMN     "sellersNotifiedAt" TIMESTAMP(3);

-- CreateIndex
CREATE INDEX "orders_sellersNotifiedAt_idx" ON "orders"("sellersNotifiedAt");
