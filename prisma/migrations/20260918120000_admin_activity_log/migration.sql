-- Append-only record of what admins do in the panel.
--
-- Purely ADDITIVE: one new table plus one foreign key onto users. No existing
-- table, column, constraint or row is altered, so applying this to a live
-- database cannot disturb anything already running. Rolling back is a single
-- DROP TABLE.
--
-- The foreign key is ON DELETE SET NULL, not CASCADE, and that is deliberate:
-- deleting an admin account must never erase the history of what that account
-- did. When the user row goes, "adminUserId" becomes NULL and the entry keeps
-- naming the person through the denormalised "adminName" / "adminEmail"
-- columns captured at the time of the action.

-- CreateTable
CREATE TABLE "admin_activity_logs" (
    "id" TEXT NOT NULL,
    "adminUserId" TEXT,
    "adminName" TEXT NOT NULL,
    "adminEmail" TEXT,
    "section" TEXT NOT NULL,
    "method" TEXT NOT NULL,
    "path" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "targetType" TEXT,
    "targetId" TEXT,
    "targetLabel" TEXT,
    "statusCode" INTEGER NOT NULL,
    "success" BOOLEAN NOT NULL,
    "changes" JSONB,
    "ipAddress" TEXT,
    "userAgent" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "admin_activity_logs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "admin_activity_logs_adminUserId_idx" ON "admin_activity_logs"("adminUserId");

-- CreateIndex
CREATE INDEX "admin_activity_logs_section_idx" ON "admin_activity_logs"("section");

-- CreateIndex
CREATE INDEX "admin_activity_logs_createdAt_idx" ON "admin_activity_logs"("createdAt");

-- The two composite indexes back the filters the panel actually offers:
-- "everything this admin did, newest first" and "everything in this section,
-- newest first". Without them those queries sort the whole table.
-- CreateIndex
CREATE INDEX "admin_activity_logs_adminUserId_createdAt_idx" ON "admin_activity_logs"("adminUserId", "createdAt");

-- CreateIndex
CREATE INDEX "admin_activity_logs_section_createdAt_idx" ON "admin_activity_logs"("section", "createdAt");

-- AddForeignKey
ALTER TABLE "admin_activity_logs" ADD CONSTRAINT "admin_activity_logs_adminUserId_fkey" FOREIGN KEY ("adminUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- ─────────────────────────────────────────────────────────────────────────────
-- OPTIONAL, AND NOT APPLIED HERE: make the table tamper-proof at the database
-- level, not just in the API.
--
-- The API exposes no delete or update route for this table, so nothing in the
-- application can remove an entry. That does not stop anyone holding database
-- credentials. If you want the stronger guarantee, revoke those rights from the
-- role the application connects as — replace yukizi_app with your actual role:
--
--   REVOKE DELETE, UPDATE, TRUNCATE ON "admin_activity_logs" FROM yukizi_app;
--
-- Run it as a superuser, once, after this migration. It is left out of the
-- migration itself on purpose: the role name differs per environment, and a
-- migration that fails on an unknown role would block every later deploy.
-- ─────────────────────────────────────────────────────────────────────────────
