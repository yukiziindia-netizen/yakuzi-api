-- CreateEnum
CREATE TYPE "ChatbotRuleTier" AS ENUM ('CORE', 'SURFACE');

-- AlterTable
ALTER TABLE "chatbot_rules" ADD COLUMN     "tier" "ChatbotRuleTier" NOT NULL DEFAULT 'SURFACE',
ADD COLUMN     "order" INTEGER NOT NULL DEFAULT 0;

-- CreateIndex
CREATE INDEX "chatbot_rules_tier_order_idx" ON "chatbot_rules"("tier", "order");
