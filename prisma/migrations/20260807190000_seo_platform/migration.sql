-- CreateEnum
CREATE TYPE "SeoEntityType" AS ENUM ('PRODUCT', 'CATEGORY', 'SUB_CATEGORY', 'BRAND', 'COLLECTION', 'BLOG_POST', 'STATIC_PAGE', 'HOMEPAGE', 'LANDING_PAGE');

-- CreateEnum
CREATE TYPE "KeywordType" AS ENUM ('PRIMARY_TOPIC', 'SECONDARY_TOPIC', 'SYNONYM', 'RELATED_ENTITY', 'BRAND_ENTITY', 'CATEGORY_ENTITY', 'NEGATIVE', 'SEASONAL');

-- CreateTable
CREATE TABLE "seo_meta" (
    "id" TEXT NOT NULL,
    "entityType" "SeoEntityType" NOT NULL,
    "entityId" TEXT NOT NULL,
    "title" TEXT,
    "description" TEXT,
    "canonicalUrl" TEXT,
    "ogTitle" TEXT,
    "ogDescription" TEXT,
    "ogImageUrl" TEXT,
    "twitterCard" TEXT DEFAULT 'summary_large_image',
    "robots" TEXT,
    "focusKeyword" TEXT,
    "secondaryKeywords" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "entityDescription" TEXT,
    "aiSummary" TEXT,
    "faq" JSONB,
    "structuredDataOverride" JSONB,
    "imageAltOverrides" JSONB,
    "seoScore" INTEGER,
    "aiVisibilityScore" INTEGER,
    "readabilityScore" INTEGER,
    "updatedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "seo_meta_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "seo_meta_revisions" (
    "id" TEXT NOT NULL,
    "seoMetaId" TEXT NOT NULL,
    "snapshot" JSONB NOT NULL,
    "changedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "seo_meta_revisions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "seo_redirects" (
    "id" TEXT NOT NULL,
    "fromPath" TEXT NOT NULL,
    "toPath" TEXT NOT NULL,
    "statusCode" INTEGER NOT NULL DEFAULT 301,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "note" TEXT,
    "hits" INTEGER NOT NULL DEFAULT 0,
    "lastHitAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "seo_redirects_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "seo_keywords" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "type" "KeywordType" NOT NULL,
    "canonicalName" TEXT,
    "synonyms" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "description" TEXT,
    "parentId" TEXT,
    "seasonStart" TIMESTAMP(3),
    "seasonEnd" TIMESTAMP(3),
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "seo_keywords_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "seo_keyword_links" (
    "id" TEXT NOT NULL,
    "keywordId" TEXT NOT NULL,
    "entityType" "SeoEntityType" NOT NULL,
    "entityId" TEXT NOT NULL,
    "weight" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "seo_keyword_links_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "seo_meta_entityType_entityId_key" ON "seo_meta"("entityType", "entityId");

-- CreateIndex
CREATE INDEX "seo_meta_entityType_idx" ON "seo_meta"("entityType");

-- CreateIndex
CREATE INDEX "seo_meta_revisions_seoMetaId_createdAt_idx" ON "seo_meta_revisions"("seoMetaId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "seo_redirects_fromPath_key" ON "seo_redirects"("fromPath");

-- CreateIndex
CREATE UNIQUE INDEX "seo_keywords_name_key" ON "seo_keywords"("name");

-- CreateIndex
CREATE INDEX "seo_keywords_type_idx" ON "seo_keywords"("type");

-- CreateIndex
CREATE UNIQUE INDEX "seo_keyword_links_keywordId_entityType_entityId_key" ON "seo_keyword_links"("keywordId", "entityType", "entityId");

-- CreateIndex
CREATE INDEX "seo_keyword_links_entityType_entityId_idx" ON "seo_keyword_links"("entityType", "entityId");

-- AddForeignKey
ALTER TABLE "seo_meta_revisions" ADD CONSTRAINT "seo_meta_revisions_seoMetaId_fkey" FOREIGN KEY ("seoMetaId") REFERENCES "seo_meta"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "seo_keywords" ADD CONSTRAINT "seo_keywords_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "seo_keywords"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "seo_keyword_links" ADD CONSTRAINT "seo_keyword_links_keywordId_fkey" FOREIGN KEY ("keywordId") REFERENCES "seo_keywords"("id") ON DELETE CASCADE ON UPDATE CASCADE;
