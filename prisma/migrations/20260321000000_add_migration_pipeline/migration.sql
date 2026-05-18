-- Migration Pipeline: Add migration tracking infrastructure
-- This migration adds:
-- 1. Migration tracking enums (MigrationEntityType, MigrationStatus, MigrationRecordStatus)
-- 2. MigrationRun table (batch run tracking)
-- 3. MigrationRecord table (per-record audit)
-- 4. MigrationIdMap table (legacy→new ID lookup)
-- 5. legacyId columns on User, Order, OrderItem, Payment

-- ──────────────────────────────────────────────
-- ENUMS
-- ──────────────────────────────────────────────

CREATE TYPE "MigrationEntityType" AS ENUM ('USER', 'ORDER', 'PAYMENT', 'ORDER_ITEM', 'SETTLEMENT');
CREATE TYPE "MigrationStatus" AS ENUM ('RUNNING', 'COMPLETED', 'FAILED', 'ROLLED_BACK');
CREATE TYPE "MigrationRecordStatus" AS ENUM ('SUCCESS', 'SKIPPED', 'FAILED');

-- ──────────────────────────────────────────────
-- MIGRATION TRACKING TABLES
-- ──────────────────────────────────────────────

CREATE TABLE "migration_runs" (
    "id" TEXT NOT NULL,
    "entityType" "MigrationEntityType" NOT NULL,
    "status" "MigrationStatus" NOT NULL DEFAULT 'RUNNING',
    "totalRecords" INTEGER NOT NULL DEFAULT 0,
    "successCount" INTEGER NOT NULL DEFAULT 0,
    "failedCount" INTEGER NOT NULL DEFAULT 0,
    "skippedCount" INTEGER NOT NULL DEFAULT 0,
    "metadata" JSONB,
    "errorSummary" TEXT,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),
    "rolledBackAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "migration_runs_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "migration_records" (
    "id" TEXT NOT NULL,
    "runId" TEXT NOT NULL,
    "entityType" "MigrationEntityType" NOT NULL,
    "legacyId" TEXT NOT NULL,
    "newId" TEXT,
    "status" "MigrationRecordStatus" NOT NULL DEFAULT 'SUCCESS',
    "errorMessage" TEXT,
    "rawData" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "migration_records_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "migration_id_map" (
    "id" TEXT NOT NULL,
    "entityType" "MigrationEntityType" NOT NULL,
    "legacyId" TEXT NOT NULL,
    "newId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "migration_id_map_pkey" PRIMARY KEY ("id")
);

-- ──────────────────────────────────────────────
-- INDEXES
-- ──────────────────────────────────────────────

CREATE INDEX "migration_runs_entityType_idx" ON "migration_runs"("entityType");
CREATE INDEX "migration_runs_status_idx" ON "migration_runs"("status");
CREATE INDEX "migration_runs_startedAt_idx" ON "migration_runs"("startedAt");

CREATE UNIQUE INDEX "migration_records_entityType_legacyId_key" ON "migration_records"("entityType", "legacyId");
CREATE INDEX "migration_records_runId_idx" ON "migration_records"("runId");
CREATE INDEX "migration_records_entityType_legacyId_idx" ON "migration_records"("entityType", "legacyId");
CREATE INDEX "migration_records_entityType_newId_idx" ON "migration_records"("entityType", "newId");
CREATE INDEX "migration_records_status_idx" ON "migration_records"("status");

CREATE UNIQUE INDEX "migration_id_map_entityType_legacyId_key" ON "migration_id_map"("entityType", "legacyId");
CREATE INDEX "migration_id_map_entityType_newId_idx" ON "migration_id_map"("entityType", "newId");

-- ──────────────────────────────────────────────
-- FOREIGN KEYS
-- ──────────────────────────────────────────────

ALTER TABLE "migration_records" ADD CONSTRAINT "migration_records_runId_fkey" FOREIGN KEY ("runId") REFERENCES "migration_runs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ──────────────────────────────────────────────
-- ADD legacyId COLUMNS (nullable, unique)
-- ──────────────────────────────────────────────

ALTER TABLE "users" ADD COLUMN "legacyId" TEXT;
CREATE UNIQUE INDEX "users_legacyId_key" ON "users"("legacyId");

ALTER TABLE "orders" ADD COLUMN "legacyId" TEXT;
CREATE UNIQUE INDEX "orders_legacyId_key" ON "orders"("legacyId");

ALTER TABLE "order_items" ADD COLUMN "legacyId" TEXT;
CREATE UNIQUE INDEX "order_items_legacyId_key" ON "order_items"("legacyId");

ALTER TABLE "payments" ADD COLUMN "legacyId" TEXT;
CREATE UNIQUE INDEX "payments_legacyId_key" ON "payments"("legacyId");
