-- CreateEnum
CREATE TYPE "ChatbotTrainingTier" AS ENUM ('CORE', 'SURFACE');

-- AlterTable
ALTER TABLE "chatbot_jobs" ADD COLUMN     "label" TEXT,
ADD COLUMN     "tier" "ChatbotTrainingTier" NOT NULL DEFAULT 'SURFACE',
ADD COLUMN     "order" INTEGER NOT NULL DEFAULT 0;

-- CreateIndex
CREATE INDEX "chatbot_jobs_tier_order_idx" ON "chatbot_jobs"("tier", "order");
