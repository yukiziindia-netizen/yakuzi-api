-- Integrations: external sales-channel connections (Shopify / WooCommerce /
-- Amazon SP-API) plus the inventory ledger that keeps them from looping.
--
-- Additive only: no existing table is altered except for the implicit foreign
-- keys added here, so this migration cannot affect current seller behaviour.

-- CreateEnum
CREATE TYPE "IntegrationProvider" AS ENUM ('SHOPIFY', 'WOOCOMMERCE', 'AMAZON');
CREATE TYPE "IntegrationStatus" AS ENUM ('CONNECTED', 'DISCONNECTED', 'ERROR', 'EXPIRED', 'PAUSED');
CREATE TYPE "IntegrationSyncDirection" AS ENUM ('IMPORT_ONLY', 'EXPORT_ONLY', 'TWO_WAY');
CREATE TYPE "InventorySourceOfTruth" AS ENUM ('YUKIZI', 'EXTERNAL');
CREATE TYPE "IntegrationMappingStatus" AS ENUM ('MAPPED', 'UNMAPPED', 'CONFLICT', 'MISSING_SKU');
CREATE TYPE "FulfillmentChannel" AS ENUM ('MERCHANT', 'AMAZON_FBA');
CREATE TYPE "InventoryEventType" AS ENUM ('EXTERNAL_INVENTORY_CHANGE', 'YUKIZI_MANUAL_CHANGE', 'ORDER_CREATED', 'ORDER_CANCELLED', 'REFUND', 'MANUAL_ADJUSTMENT', 'INITIAL_IMPORT', 'SYNC_RECONCILIATION');
CREATE TYPE "InventoryEventStatus" AS ENUM ('PENDING', 'PROCESSED', 'SKIPPED', 'FAILED');
CREATE TYPE "SyncJobStatus" AS ENUM ('PENDING', 'PROCESSING', 'COMPLETED', 'FAILED');
CREATE TYPE "SyncJobType" AS ENUM ('INITIAL_IMPORT', 'INVENTORY_PUSH', 'INVENTORY_PULL', 'RECONCILIATION', 'WEBHOOK_REGISTRATION');
CREATE TYPE "IntegrationLogStatus" AS ENUM ('SUCCESS', 'WARNING', 'FAILURE');

-- CreateTable
CREATE TABLE "seller_integrations" (
    "id" TEXT NOT NULL,
    "sellerId" TEXT NOT NULL,
    "provider" "IntegrationProvider" NOT NULL,
    "status" "IntegrationStatus" NOT NULL DEFAULT 'DISCONNECTED',
    "externalAccountId" TEXT NOT NULL,
    "externalStoreName" TEXT,
    "externalStoreUrl" TEXT,
    "marketplaceId" TEXT,
    "region" TEXT,
    "encryptedCredentials" TEXT,
    "credentialsKeyVersion" INTEGER NOT NULL DEFAULT 1,
    "scopes" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "syncEnabled" BOOLEAN NOT NULL DEFAULT true,
    "syncProducts" BOOLEAN NOT NULL DEFAULT true,
    "syncInventory" BOOLEAN NOT NULL DEFAULT true,
    "syncPrices" BOOLEAN NOT NULL DEFAULT false,
    "syncOrders" BOOLEAN NOT NULL DEFAULT false,
    "inventoryDirection" "IntegrationSyncDirection" NOT NULL DEFAULT 'IMPORT_ONLY',
    "sourceOfTruth" "InventorySourceOfTruth" NOT NULL DEFAULT 'YUKIZI',
    "setupCompletedAt" TIMESTAMP(3),
    "lastSyncAt" TIMESTAMP(3),
    "lastSuccessfulSyncAt" TIMESTAMP(3),
    "lastError" TEXT,
    "lastErrorAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "disconnectedAt" TIMESTAMP(3),

    CONSTRAINT "seller_integrations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "integration_webhooks" (
    "id" TEXT NOT NULL,
    "integrationId" TEXT NOT NULL,
    "externalId" TEXT NOT NULL,
    "topic" TEXT NOT NULL,
    "encryptedSecret" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "integration_webhooks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "integration_product_mappings" (
    "id" TEXT NOT NULL,
    "sellerId" TEXT NOT NULL,
    "integrationId" TEXT NOT NULL,
    "sellerOfferId" TEXT,
    "catalogProductId" TEXT,
    "yukiziSku" TEXT,
    "externalProductId" TEXT NOT NULL,
    "externalVariantId" TEXT,
    "externalSku" TEXT,
    "externalListingId" TEXT,
    "externalTitle" TEXT,
    "asin" TEXT,
    "marketplaceId" TEXT,
    "fulfillmentChannel" "FulfillmentChannel" NOT NULL DEFAULT 'MERCHANT',
    "status" "IntegrationMappingStatus" NOT NULL DEFAULT 'UNMAPPED',
    "mappedManuallyAt" TIMESTAMP(3),
    "lastSyncedAt" TIMESTAMP(3),
    "lastError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "integration_product_mappings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "inventory_events" (
    "id" TEXT NOT NULL,
    "sellerId" TEXT NOT NULL,
    "integrationId" TEXT,
    "mappingId" TEXT,
    "sellerOfferId" TEXT,
    "sourcePlatform" TEXT NOT NULL,
    "sourceEventId" TEXT,
    "idempotencyKey" TEXT,
    "eventType" "InventoryEventType" NOT NULL,
    "status" "InventoryEventStatus" NOT NULL DEFAULT 'PENDING',
    "oldQuantity" INTEGER,
    "newQuantity" INTEGER,
    "quantityDelta" INTEGER,
    "skipReason" TEXT,
    "lastError" TEXT,
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processedAt" TIMESTAMP(3),

    CONSTRAINT "inventory_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "integration_sync_jobs" (
    "id" TEXT NOT NULL,
    "sellerId" TEXT NOT NULL,
    "integrationId" TEXT NOT NULL,
    "jobType" "SyncJobType" NOT NULL,
    "status" "SyncJobStatus" NOT NULL DEFAULT 'PENDING',
    "payload" JSONB,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "maxAttempts" INTEGER NOT NULL DEFAULT 5,
    "runAfter" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "permanentFailure" BOOLEAN NOT NULL DEFAULT false,
    "lastError" TEXT,
    "totalItems" INTEGER NOT NULL DEFAULT 0,
    "processedItems" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "integration_sync_jobs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "integration_logs" (
    "id" TEXT NOT NULL,
    "sellerId" TEXT NOT NULL,
    "integrationId" TEXT,
    "action" TEXT NOT NULL,
    "status" "IntegrationLogStatus" NOT NULL,
    "entityRef" TEXT,
    "message" TEXT,
    "detail" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "integration_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "integration_oauth_states" (
    "id" TEXT NOT NULL,
    "state" TEXT NOT NULL,
    "sellerId" TEXT NOT NULL,
    "provider" "IntegrationProvider" NOT NULL,
    "context" JSONB,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "consumedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "integration_oauth_states_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "seller_integrations_sellerId_idx" ON "seller_integrations"("sellerId");
CREATE INDEX "seller_integrations_sellerId_provider_idx" ON "seller_integrations"("sellerId", "provider");
CREATE INDEX "seller_integrations_status_idx" ON "seller_integrations"("status");
CREATE UNIQUE INDEX "seller_integrations_sellerId_provider_externalAccountId_key" ON "seller_integrations"("sellerId", "provider", "externalAccountId");

CREATE INDEX "integration_webhooks_integrationId_idx" ON "integration_webhooks"("integrationId");
CREATE UNIQUE INDEX "integration_webhooks_integrationId_topic_externalId_key" ON "integration_webhooks"("integrationId", "topic", "externalId");

CREATE INDEX "integration_product_mappings_sellerId_idx" ON "integration_product_mappings"("sellerId");
CREATE INDEX "integration_product_mappings_integrationId_status_idx" ON "integration_product_mappings"("integrationId", "status");
CREATE INDEX "integration_product_mappings_sellerOfferId_idx" ON "integration_product_mappings"("sellerOfferId");
CREATE INDEX "integration_product_mappings_externalSku_idx" ON "integration_product_mappings"("externalSku");
CREATE UNIQUE INDEX "integration_product_mappings_integrationId_externalProductId_externalVariantId_key" ON "integration_product_mappings"("integrationId", "externalProductId", "externalVariantId");

CREATE INDEX "inventory_events_sellerId_receivedAt_idx" ON "inventory_events"("sellerId", "receivedAt");
CREATE INDEX "inventory_events_integrationId_receivedAt_idx" ON "inventory_events"("integrationId", "receivedAt");
CREATE INDEX "inventory_events_status_idx" ON "inventory_events"("status");
CREATE INDEX "inventory_events_idempotencyKey_idx" ON "inventory_events"("idempotencyKey");
-- Idempotency enforced by the database, not just by application code: a
-- redelivered provider webhook carrying the same event id cannot be applied
-- to inventory a second time.
CREATE UNIQUE INDEX "inventory_events_sourcePlatform_sourceEventId_key" ON "inventory_events"("sourcePlatform", "sourceEventId");

CREATE INDEX "integration_sync_jobs_status_runAfter_idx" ON "integration_sync_jobs"("status", "runAfter");
CREATE INDEX "integration_sync_jobs_integrationId_status_idx" ON "integration_sync_jobs"("integrationId", "status");
CREATE INDEX "integration_sync_jobs_sellerId_createdAt_idx" ON "integration_sync_jobs"("sellerId", "createdAt");

CREATE INDEX "integration_logs_sellerId_createdAt_idx" ON "integration_logs"("sellerId", "createdAt");
CREATE INDEX "integration_logs_integrationId_createdAt_idx" ON "integration_logs"("integrationId", "createdAt");

CREATE UNIQUE INDEX "integration_oauth_states_state_key" ON "integration_oauth_states"("state");
CREATE INDEX "integration_oauth_states_sellerId_provider_idx" ON "integration_oauth_states"("sellerId", "provider");
CREATE INDEX "integration_oauth_states_expiresAt_idx" ON "integration_oauth_states"("expiresAt");

-- AddForeignKey
ALTER TABLE "seller_integrations" ADD CONSTRAINT "seller_integrations_sellerId_fkey" FOREIGN KEY ("sellerId") REFERENCES "seller_profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "integration_webhooks" ADD CONSTRAINT "integration_webhooks_integrationId_fkey" FOREIGN KEY ("integrationId") REFERENCES "seller_integrations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "integration_product_mappings" ADD CONSTRAINT "integration_product_mappings_integrationId_fkey" FOREIGN KEY ("integrationId") REFERENCES "seller_integrations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "integration_product_mappings" ADD CONSTRAINT "integration_product_mappings_sellerOfferId_fkey" FOREIGN KEY ("sellerOfferId") REFERENCES "seller_offers"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "inventory_events" ADD CONSTRAINT "inventory_events_integrationId_fkey" FOREIGN KEY ("integrationId") REFERENCES "seller_integrations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "inventory_events" ADD CONSTRAINT "inventory_events_mappingId_fkey" FOREIGN KEY ("mappingId") REFERENCES "integration_product_mappings"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "integration_sync_jobs" ADD CONSTRAINT "integration_sync_jobs_integrationId_fkey" FOREIGN KEY ("integrationId") REFERENCES "seller_integrations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "integration_logs" ADD CONSTRAINT "integration_logs_integrationId_fkey" FOREIGN KEY ("integrationId") REFERENCES "seller_integrations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
