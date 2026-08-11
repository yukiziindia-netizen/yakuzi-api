-- Data fix: PRODUCT SEO records were being keyed by seller-offer ids in some
-- paths (the public product payload exposes `id = sellerOffer.id` when a
-- listing exists) and by catalog-product ids in others. The stable key is the
-- catalog product id (one per product page, survives listing changes), so
-- remap every offer-keyed record onto its catalog id.
--
-- Guarded: rows whose target key already has a record are left untouched
-- (the master-keyed record wins; nothing is deleted).

UPDATE "seo_meta" sm
SET "entityId" = pv."catalogProductId"
FROM "seller_offers" so
JOIN "product_variants" pv ON pv."id" = so."variantId"
WHERE sm."entityType" = 'PRODUCT'
  AND sm."entityId" = so."id"
  AND NOT EXISTS (
    SELECT 1 FROM "seo_meta" other
    WHERE other."entityType" = 'PRODUCT'
      AND other."entityId" = pv."catalogProductId"
      AND other."id" <> sm."id"
  );

UPDATE "seo_keyword_links" kl
SET "entityId" = pv."catalogProductId"
FROM "seller_offers" so
JOIN "product_variants" pv ON pv."id" = so."variantId"
WHERE kl."entityType" = 'PRODUCT'
  AND kl."entityId" = so."id"
  AND NOT EXISTS (
    SELECT 1 FROM "seo_keyword_links" other
    WHERE other."keywordId" = kl."keywordId"
      AND other."entityType" = 'PRODUCT'
      AND other."entityId" = pv."catalogProductId"
      AND other."id" <> kl."id"
  );
