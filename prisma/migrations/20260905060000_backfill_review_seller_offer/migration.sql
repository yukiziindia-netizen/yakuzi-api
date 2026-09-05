-- Reviews created before 2026-08-23 predate the code that stamps
-- Review.sellerOfferId at creation time, so they carry NULL there. That makes
-- them invisible to the seller reviews tab (GET /reviews/seller scopes through
-- sellerOffer.sellerId) and leaves them out of every seller's average rating.
--
-- Attribute each orphaned review to the listing its buyer actually purchased,
-- using the same rule createReview/findPurchase applies today: a non-cancelled
-- order by the review's author containing an item whose offer sells this
-- catalog product (directly, or through a variant). Oldest matching purchase
-- wins when there are several. Reviews whose author has no surviving
-- non-cancelled purchase of the product remain NULL — they were never
-- attributable to a seller.
UPDATE "reviews" r
SET "sellerOfferId" = picked."sellerOfferId"
FROM (
  SELECT DISTINCT ON (r2."id") r2."id" AS review_id, oi."sellerOfferId"
  FROM "reviews" r2
  JOIN "orders" o
    ON o."buyerId" = r2."userId"
   AND o."orderStatus" <> 'CANCELLED'
  JOIN "order_items" oi ON oi."orderId" = o."id"
  JOIN "seller_offers" so ON so."id" = oi."sellerOfferId"
  LEFT JOIN "product_variants" pv ON pv."id" = so."variantId"
  WHERE r2."sellerOfferId" IS NULL
    AND (so."catalogProductId" = r2."catalogProductId"
         OR pv."catalogProductId" = r2."catalogProductId")
  ORDER BY r2."id", oi."createdAt" ASC
) picked
WHERE r."id" = picked.review_id;

-- Bring seller ratings in line with the newly attributed reviews — the same
-- aggregate updateSellerRating runs on every review create/delete, rounded to
-- one decimal the same way.
UPDATE "seller_profiles" sp
SET "rating" = ROUND(agg.avg_rating::numeric, 1)
FROM (
  SELECT so."sellerId" AS seller_id, AVG(r."rating") AS avg_rating
  FROM "reviews" r
  JOIN "seller_offers" so ON so."id" = r."sellerOfferId"
  GROUP BY so."sellerId"
) agg
WHERE sp."id" = agg.seller_id;
