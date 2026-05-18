/*
  Warnings:

  - A unique constraint covering the columns `[slug,categoryId]` on the table `sub_categories` will be added. If there are existing duplicate values, this will fail.

*/
-- DropIndex
DROP INDEX "sub_categories_slug_key";

-- CreateIndex
CREATE UNIQUE INDEX "sub_categories_slug_categoryId_key" ON "sub_categories"("slug", "categoryId");
