-- AlterTable
ALTER TABLE "seller_offers" ADD COLUMN     "createdByAdminId" TEXT;

-- AddForeignKey
ALTER TABLE "seller_offers" ADD CONSTRAINT "seller_offers_createdByAdminId_fkey" FOREIGN KEY ("createdByAdminId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
