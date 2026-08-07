-- CreateTable
CREATE TABLE "_ProductExtraCategories" (
    "A" TEXT NOT NULL,
    "B" TEXT NOT NULL,

    CONSTRAINT "_ProductExtraCategories_AB_pkey" PRIMARY KEY ("A","B")
);

-- CreateTable
CREATE TABLE "_ProductExtraSubCategories" (
    "A" TEXT NOT NULL,
    "B" TEXT NOT NULL,

    CONSTRAINT "_ProductExtraSubCategories_AB_pkey" PRIMARY KEY ("A","B")
);

-- CreateIndex
CREATE INDEX "_ProductExtraCategories_B_index" ON "_ProductExtraCategories"("B");

-- CreateIndex
CREATE INDEX "_ProductExtraSubCategories_B_index" ON "_ProductExtraSubCategories"("B");

-- AddForeignKey
ALTER TABLE "_ProductExtraCategories" ADD CONSTRAINT "_ProductExtraCategories_A_fkey" FOREIGN KEY ("A") REFERENCES "catalog_products"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_ProductExtraCategories" ADD CONSTRAINT "_ProductExtraCategories_B_fkey" FOREIGN KEY ("B") REFERENCES "categories"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_ProductExtraSubCategories" ADD CONSTRAINT "_ProductExtraSubCategories_A_fkey" FOREIGN KEY ("A") REFERENCES "catalog_products"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_ProductExtraSubCategories" ADD CONSTRAINT "_ProductExtraSubCategories_B_fkey" FOREIGN KEY ("B") REFERENCES "sub_categories"("id") ON DELETE CASCADE ON UPDATE CASCADE;

