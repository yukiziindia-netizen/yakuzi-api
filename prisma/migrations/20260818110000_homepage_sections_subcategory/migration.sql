-- AlterTable
ALTER TABLE "homepage_sections" ALTER COLUMN "categoryId" DROP NOT NULL;
ALTER TABLE "homepage_sections" ADD COLUMN "subCategoryId" TEXT;

-- CreateIndex
CREATE INDEX "homepage_sections_subCategoryId_idx" ON "homepage_sections"("subCategoryId");

-- AddForeignKey
ALTER TABLE "homepage_sections" ADD CONSTRAINT "homepage_sections_subCategoryId_fkey" FOREIGN KEY ("subCategoryId") REFERENCES "sub_categories"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Exactly one of categoryId/subCategoryId must be set — a section is sourced
-- from a Collection XOR a Sub-collection, never both, never neither.
ALTER TABLE "homepage_sections" ADD CONSTRAINT "homepage_sections_exactly_one_source" CHECK (("categoryId" IS NOT NULL) != ("subCategoryId" IS NOT NULL));
