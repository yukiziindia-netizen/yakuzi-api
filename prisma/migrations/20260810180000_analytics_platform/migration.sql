-- CreateEnum
CREATE TYPE "SourceCategory" AS ENUM ('ORGANIC_SEARCH', 'AI', 'SOCIAL', 'VIDEO', 'REFERRAL', 'DIRECT', 'PAID', 'EMAIL', 'MESSAGING', 'UNKNOWN');

-- CreateEnum
CREATE TYPE "AttributionLevel" AS ENUM ('UTM', 'CLICK_ID', 'REFERRER', 'DIRECT', 'UNKNOWN');

-- CreateTable
CREATE TABLE "analytics_visitors" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "userId" TEXT,
    "firstSource" TEXT,
    "firstSourceCategory" "SourceCategory" NOT NULL DEFAULT 'UNKNOWN',
    "firstMedium" TEXT,
    "firstCampaign" TEXT,
    "firstReferrerDomain" TEXT,
    "firstLandingPage" TEXT,
    "firstAttributionLevel" "AttributionLevel" NOT NULL DEFAULT 'UNKNOWN',
    "lastSource" TEXT,
    "lastSourceCategory" "SourceCategory" NOT NULL DEFAULT 'UNKNOWN',
    "lastCampaign" TEXT,
    "lastReferrerDomain" TEXT,
    "lastLandingPage" TEXT,
    "sessionsCount" INTEGER NOT NULL DEFAULT 0,
    "pageviewsCount" INTEGER NOT NULL DEFAULT 0,
    "totalEngagedMs" INTEGER NOT NULL DEFAULT 0,
    "deviceType" TEXT,
    "os" TEXT,
    "browser" TEXT,
    "country" TEXT,
    "region" TEXT,
    "city" TEXT,
    "language" TEXT,
    "timezone" TEXT,
    "screenW" INTEGER,
    "screenH" INTEGER,
    "isBot" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "analytics_visitors_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "analytics_sessions" (
    "id" TEXT NOT NULL,
    "visitorId" TEXT NOT NULL,
    "userId" TEXT,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastEventAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "durationMs" INTEGER NOT NULL DEFAULT 0,
    "entryPage" TEXT,
    "exitPage" TEXT,
    "pageviews" INTEGER NOT NULL DEFAULT 0,
    "productViews" INTEGER NOT NULL DEFAULT 0,
    "events" INTEGER NOT NULL DEFAULT 0,
    "engagedMs" INTEGER NOT NULL DEFAULT 0,
    "source" TEXT,
    "sourceCategory" "SourceCategory" NOT NULL DEFAULT 'UNKNOWN',
    "medium" TEXT,
    "campaign" TEXT,
    "utmTerm" TEXT,
    "utmContent" TEXT,
    "referrerDomain" TEXT,
    "attributionLevel" "AttributionLevel" NOT NULL DEFAULT 'UNKNOWN',
    "clickIds" JSONB,
    "deviceType" TEXT,
    "os" TEXT,
    "browser" TEXT,
    "country" TEXT,
    "region" TEXT,
    "city" TEXT,
    "isNewVisitor" BOOLEAN NOT NULL DEFAULT false,
    "isBot" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "analytics_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "analytics_events" (
    "id" TEXT NOT NULL,
    "visitorId" TEXT NOT NULL,
    "sessionId" TEXT,
    "userId" TEXT,
    "name" TEXT NOT NULL,
    "ts" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "page" TEXT,
    "productId" TEXT,
    "props" JSONB,

    CONSTRAINT "analytics_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "analytics_daily" (
    "date" DATE NOT NULL,
    "kind" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "visitors" INTEGER NOT NULL DEFAULT 0,
    "newVisitors" INTEGER NOT NULL DEFAULT 0,
    "sessions" INTEGER NOT NULL DEFAULT 0,
    "pageviews" INTEGER NOT NULL DEFAULT 0,
    "productViews" INTEGER NOT NULL DEFAULT 0,
    "signups" INTEGER NOT NULL DEFAULT 0,
    "purchases" INTEGER NOT NULL DEFAULT 0,
    "revenue" DECIMAL(14,2) NOT NULL DEFAULT 0,

    CONSTRAINT "analytics_daily_pkey" PRIMARY KEY ("date","kind","key")
);

-- CreateIndex
CREATE INDEX "analytics_visitors_userId_idx" ON "analytics_visitors"("userId");

-- CreateIndex
CREATE INDEX "analytics_visitors_createdAt_idx" ON "analytics_visitors"("createdAt");

-- CreateIndex
CREATE INDEX "analytics_visitors_lastSeenAt_idx" ON "analytics_visitors"("lastSeenAt");

-- CreateIndex
CREATE INDEX "analytics_visitors_firstSourceCategory_idx" ON "analytics_visitors"("firstSourceCategory");

-- CreateIndex
CREATE INDEX "analytics_visitors_country_idx" ON "analytics_visitors"("country");

-- CreateIndex
CREATE INDEX "analytics_visitors_isBot_idx" ON "analytics_visitors"("isBot");

-- CreateIndex
CREATE INDEX "analytics_sessions_visitorId_idx" ON "analytics_sessions"("visitorId");

-- CreateIndex
CREATE INDEX "analytics_sessions_userId_idx" ON "analytics_sessions"("userId");

-- CreateIndex
CREATE INDEX "analytics_sessions_startedAt_idx" ON "analytics_sessions"("startedAt");

-- CreateIndex
CREATE INDEX "analytics_sessions_sourceCategory_startedAt_idx" ON "analytics_sessions"("sourceCategory", "startedAt");

-- CreateIndex
CREATE INDEX "analytics_sessions_campaign_idx" ON "analytics_sessions"("campaign");

-- CreateIndex
CREATE INDEX "analytics_sessions_country_idx" ON "analytics_sessions"("country");

-- CreateIndex
CREATE INDEX "analytics_sessions_isBot_startedAt_idx" ON "analytics_sessions"("isBot", "startedAt");

-- CreateIndex
CREATE INDEX "analytics_events_name_ts_idx" ON "analytics_events"("name", "ts");

-- CreateIndex
CREATE INDEX "analytics_events_ts_idx" ON "analytics_events"("ts");

-- CreateIndex
CREATE INDEX "analytics_events_visitorId_ts_idx" ON "analytics_events"("visitorId", "ts");

-- CreateIndex
CREATE INDEX "analytics_events_sessionId_idx" ON "analytics_events"("sessionId");

-- CreateIndex
CREATE INDEX "analytics_events_userId_idx" ON "analytics_events"("userId");

-- CreateIndex
CREATE INDEX "analytics_events_productId_idx" ON "analytics_events"("productId");
