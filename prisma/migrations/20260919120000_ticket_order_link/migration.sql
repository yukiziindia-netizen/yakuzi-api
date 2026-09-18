-- Lets a support ticket say which order it is about.
--
-- Purely ADDITIVE: one new NULLABLE column on "tickets", one index, one
-- foreign key. Every existing ticket keeps working with orderId NULL, and no
-- existing column, constraint or row is altered. Safe to apply to a live
-- database.
--
-- The foreign key is ON DELETE SET NULL, not CASCADE, on purpose: deleting an
-- order must never delete the conversation about it. Support still has to be
-- able to read what happened after the fact.

-- AlterTable
ALTER TABLE "tickets" ADD COLUMN     "orderId" TEXT;

-- CreateIndex
CREATE INDEX "tickets_orderId_idx" ON "tickets"("orderId");

-- AddForeignKey
ALTER TABLE "tickets" ADD CONSTRAINT "tickets_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "orders"("id") ON DELETE SET NULL ON UPDATE CASCADE;
