-- CreateTable
CREATE TABLE "chatbot_rules" (
    "id" TEXT NOT NULL,
    "trigger" TEXT NOT NULL,
    "instruction" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "chatbot_rules_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "chatbot_rules_isActive_idx" ON "chatbot_rules"("isActive");
