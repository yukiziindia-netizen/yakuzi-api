-- Self-ship fulfillment mode (strictly additive)
ALTER TABLE "seller_profiles" ADD COLUMN "selfShipEnabled" BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE "orders" ADD COLUMN "fulfillmentMode" TEXT NOT NULL DEFAULT 'shiprocket';
ALTER TABLE "orders" ADD COLUMN "trackingUrl" TEXT;
ALTER TABLE "orders" ADD COLUMN "shippedAt" TIMESTAMP(3);
