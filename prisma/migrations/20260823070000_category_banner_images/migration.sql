-- CreateTable
CREATE TABLE "category_banner_images" (
    "id" TEXT NOT NULL,
    "categoryId" TEXT,
    "subCategoryId" TEXT,
    "image" TEXT NOT NULL,
    "mobileImage" TEXT,
    "order" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "category_banner_images_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "category_banner_images_categoryId_idx" ON "category_banner_images"("categoryId");

-- CreateIndex
CREATE INDEX "category_banner_images_subCategoryId_idx" ON "category_banner_images"("subCategoryId");

-- AddForeignKey
ALTER TABLE "category_banner_images" ADD CONSTRAINT "category_banner_images_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "categories"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "category_banner_images" ADD CONSTRAINT "category_banner_images_subCategoryId_fkey" FOREIGN KEY ("subCategoryId") REFERENCES "sub_categories"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Exactly one parent (same convention as homepage_sections_exactly_one_source)
ALTER TABLE "category_banner_images" ADD CONSTRAINT "category_banner_images_exactly_one_parent" CHECK (("categoryId" IS NOT NULL) != ("subCategoryId" IS NOT NULL));

-- Data migration: every category's existing single desktop/mobile banner pair
-- becomes slide 1 of its slideshow, so nothing changes visually until an admin
-- adds more slides.
INSERT INTO "category_banner_images" ("id", "categoryId", "image", "mobileImage", "order")
SELECT gen_random_uuid(), "id", "image", "mobileImage", 0
FROM "categories"
WHERE "image" IS NOT NULL;
