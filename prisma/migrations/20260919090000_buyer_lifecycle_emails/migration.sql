-- Buyer lifecycle emails: a send-once ledger, and somewhere to record refunds.
--
-- Purely ADDITIVE. One new table, and four new NULLABLE columns on "orders".
-- No existing column is altered or dropped, no constraint changes, no data is
-- rewritten, and every new column defaults to NULL — so every row already in
-- "orders" stays valid and every query written against it keeps working.
-- Applying this to the live database cannot disturb anything running.
--
-- Rollback is DROP TABLE "email_dispatches" plus four DROP COLUMNs.

-- AlterTable: record that a refund actually went back to the buyer.
ALTER TABLE "orders" ADD COLUMN     "refundedAt" TIMESTAMP(3),
                     ADD COLUMN     "refundAmount" DECIMAL(10,2),
                     ADD COLUMN     "refundReference" TEXT,
                     ADD COLUMN     "refundNotes" TEXT;

-- CreateTable: one row per lifecycle email that must only ever be sent once.
CREATE TABLE "email_dispatches" (
    "id" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "dedupeKey" TEXT NOT NULL,
    "userId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "email_dispatches_pkey" PRIMARY KEY ("id")
);

-- This is the load-bearing one. The cron jobs re-read the same orders and
-- carts on every run; without a unique index, two overlapping runs would each
-- decide they were first and the buyer would get the mail twice.
-- CreateIndex
CREATE UNIQUE INDEX "email_dispatches_kind_dedupeKey_key" ON "email_dispatches"("kind", "dedupeKey");

-- CreateIndex
CREATE INDEX "email_dispatches_kind_createdAt_idx" ON "email_dispatches"("kind", "createdAt");

-- CreateIndex
CREATE INDEX "email_dispatches_userId_idx" ON "email_dispatches"("userId");
