-- The 404 log for the admin redirect tool.
-- One row per path with a hit counter, not an event log: the volume is driven
-- by bots probing for /wp-login.php and an append-only table of that would be
-- all cost and no signal.

CREATE TYPE "SeoNotFoundStatus" AS ENUM ('NEW', 'FIXED', 'IGNORED');

CREATE TABLE "seo_not_found" (
    "id" TEXT NOT NULL,
    "path" TEXT NOT NULL,
    "hits" INTEGER NOT NULL DEFAULT 1,
    "lastReferrer" TEXT,
    "lastUserAgent" TEXT,
    "status" "SeoNotFoundStatus" NOT NULL DEFAULT 'NEW',
    "firstSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "seo_not_found_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "seo_not_found_path_key" ON "seo_not_found"("path");
CREATE INDEX "seo_not_found_status_hits_idx" ON "seo_not_found"("status", "hits");
CREATE INDEX "seo_not_found_lastSeenAt_idx" ON "seo_not_found"("lastSeenAt");

-- Redirects are now sortable by hit count in the admin list.
CREATE INDEX "seo_redirects_hits_idx" ON "seo_redirects"("hits");
