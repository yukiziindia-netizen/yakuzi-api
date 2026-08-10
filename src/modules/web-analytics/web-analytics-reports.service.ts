import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../database/prisma.service';
import { WebAnalyticsService } from './web-analytics.service';

/**
 * Admin report queries. All queries are date-bounded and hit the indexes
 * created by the analytics migration; bots are excluded everywhere except
 * the traffic-quality report. BigInt counts from $queryRaw are normalized
 * to Number before serialization.
 */

export interface ReportRange {
  from: Date;
  to: Date;
}

function n(v: unknown): number {
  return typeof v === 'bigint' ? Number(v) : Number(v ?? 0);
}

function mapRows<T extends Record<string, unknown>>(rows: T[]): Array<Record<string, unknown>> {
  return rows.map((r) => Object.fromEntries(Object.entries(r).map(([k, v]) => [k, typeof v === 'bigint' ? Number(v) : v])));
}

@Injectable()
export class WebAnalyticsReportsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly analytics: WebAnalyticsService,
  ) {}

  // ─── Overview ──────────────────────────────────────────────────────

  async overview(range: ReportRange) {
    const [current, previous, daily] = await Promise.all([
      this.kpis(range),
      this.kpis(previousPeriod(range)),
      this.dailySeries(range),
    ]);
    return { current, previous, daily };
  }

  private async kpis({ from, to }: ReportRange) {
    const [sessionAgg, visitors, newVisitors, signups, purchases] = await Promise.all([
      this.prisma.webSession.aggregate({
        where: { startedAt: { gte: from, lt: to }, isBot: false },
        _count: true,
        _sum: { pageviews: true, productViews: true, engagedMs: true },
      }),
      this.prisma.webSession.groupBy({ by: ['visitorId'], where: { startedAt: { gte: from, lt: to }, isBot: false } }),
      this.prisma.webVisitor.count({ where: { createdAt: { gte: from, lt: to }, isBot: false } }),
      this.prisma.webEvent.count({ where: { name: 'signup_completed', ts: { gte: from, lt: to } } }),
      this.prisma.webEvent.findMany({ where: { name: 'purchase', ts: { gte: from, lt: to } }, select: { props: true } }),
    ]);
    const revenue = purchases.reduce((s, p) => s + (Number((p.props as { amount?: unknown })?.amount) || 0), 0);
    const sessions = sessionAgg._count;
    return {
      visitors: visitors.length,
      newVisitors,
      returningVisitors: Math.max(visitors.length - newVisitors, 0),
      sessions,
      pageviews: n(sessionAgg._sum.pageviews),
      productViews: n(sessionAgg._sum.productViews),
      avgEngagedMs: sessions ? Math.round(n(sessionAgg._sum.engagedMs) / sessions) : 0,
      signups,
      purchases: purchases.length,
      revenue,
      signupRate: visitors.length ? +(100 * (signups / visitors.length)).toFixed(2) : 0,
      conversionRate: visitors.length ? +(100 * (purchases.length / visitors.length)).toFixed(2) : 0,
    };
  }

  private async dailySeries({ from, to }: ReportRange) {
    // Rollup covers closed days; today is computed live for freshness.
    const rows = await this.prisma.webDailyStat.findMany({
      where: { kind: 'total', date: { gte: from, lt: to } },
      orderBy: { date: 'asc' },
    });
    return rows.map((r) => ({
      date: r.date.toISOString().slice(0, 10),
      visitors: r.visitors,
      newVisitors: r.newVisitors,
      sessions: r.sessions,
      pageviews: r.pageviews,
      signups: r.signups,
      purchases: r.purchases,
      revenue: Number(r.revenue),
    }));
  }

  // ─── Acquisition ───────────────────────────────────────────────────

  async acquisition(range: ReportRange) {
    const { from, to } = range;
    const [byCategory, bySource, referrers] = await Promise.all([
      this.prisma.$queryRaw<Array<Record<string, unknown>>>(Prisma.sql`
        SELECT s."sourceCategory"::text AS category,
               COUNT(DISTINCT s."visitorId") AS visitors,
               COUNT(*) AS sessions,
               COUNT(*) FILTER (WHERE s."isNewVisitor") AS "newSessions",
               COALESCE(SUM(s."pageviews"), 0) AS pageviews,
               COALESCE(SUM(s."productViews"), 0) AS "productViews",
               COALESCE(AVG(s."engagedMs"), 0)::int AS "avgEngagedMs"
        FROM "analytics_sessions" s
        WHERE s."startedAt" >= ${from} AND s."startedAt" < ${to} AND s."isBot" = false
        GROUP BY s."sourceCategory" ORDER BY sessions DESC
      `),
      this.sourceTable(range, null),
      this.prisma.$queryRaw<Array<Record<string, unknown>>>(Prisma.sql`
        SELECT s."referrerDomain" AS domain,
               COUNT(DISTINCT s."visitorId") AS visitors, COUNT(*) AS sessions
        FROM "analytics_sessions" s
        WHERE s."startedAt" >= ${from} AND s."startedAt" < ${to} AND s."isBot" = false
          AND s."referrerDomain" IS NOT NULL
        GROUP BY s."referrerDomain" ORDER BY sessions DESC LIMIT 30
      `),
    ]);
    return { byCategory: mapRows(byCategory), bySource, topReferrers: mapRows(referrers) };
  }

  /** Source table with signup/purchase joins; category filter enables drill-down. */
  async sourceTable({ from, to }: ReportRange, category: string | null) {
    const categoryFilter = category ? Prisma.sql`AND s."sourceCategory" = ${category}::"SourceCategory"` : Prisma.empty;
    const rows = await this.prisma.$queryRaw<Array<Record<string, unknown>>>(Prisma.sql`
      WITH sess AS (
        SELECT s.* FROM "analytics_sessions" s
        WHERE s."startedAt" >= ${from} AND s."startedAt" < ${to} AND s."isBot" = false ${categoryFilter}
      ),
      conv AS (
        SELECT e."visitorId",
               COUNT(*) FILTER (WHERE e."name" = 'signup_completed') AS signups,
               COUNT(*) FILTER (WHERE e."name" = 'purchase') AS purchases,
               COALESCE(SUM(CASE WHEN e."name" = 'purchase' THEN (e."props"->>'amount')::numeric ELSE 0 END), 0) AS revenue
        FROM "analytics_events" e
        WHERE e."ts" >= ${from} AND e."ts" < ${to} AND e."name" IN ('signup_completed','purchase')
        GROUP BY e."visitorId"
      )
      SELECT sess."source", sess."sourceCategory"::text AS category,
             COUNT(DISTINCT sess."visitorId") AS visitors,
             COUNT(*) AS sessions,
             COUNT(*) FILTER (WHERE sess."isNewVisitor") AS "newSessions",
             COALESCE(SUM(sess."pageviews"), 0) AS pageviews,
             COALESCE(SUM(sess."productViews"), 0) AS "productViews",
             COALESCE(SUM(conv.signups), 0) AS signups,
             COALESCE(SUM(conv.purchases), 0) AS purchases,
             COALESCE(SUM(conv.revenue), 0) AS revenue
      FROM sess
      LEFT JOIN conv ON conv."visitorId" = sess."visitorId"
      GROUP BY sess."source", sess."sourceCategory"
      ORDER BY sessions DESC LIMIT 50
    `);
    return mapRows(rows);
  }

  // ─── AI traffic ────────────────────────────────────────────────────

  async aiTraffic(range: ReportRange) {
    const { from, to } = range;
    const [sources, landingPages, products, totals] = await Promise.all([
      this.sourceTable(range, 'AI'),
      this.prisma.$queryRaw<Array<Record<string, unknown>>>(Prisma.sql`
        SELECT s."entryPage" AS page, COUNT(*) AS sessions, COUNT(DISTINCT s."visitorId") AS visitors
        FROM "analytics_sessions" s
        WHERE s."startedAt" >= ${from} AND s."startedAt" < ${to} AND s."isBot" = false AND s."sourceCategory" = 'AI'
        GROUP BY s."entryPage" ORDER BY sessions DESC LIMIT 15
      `),
      this.prisma.$queryRaw<Array<Record<string, unknown>>>(Prisma.sql`
        SELECT e."productId", COUNT(*) AS views, COUNT(DISTINCT e."visitorId") AS visitors
        FROM "analytics_events" e
        JOIN "analytics_sessions" s ON s."id" = e."sessionId"
        WHERE e."ts" >= ${from} AND e."ts" < ${to} AND e."name" = 'product_view'
          AND s."sourceCategory" = 'AI' AND s."isBot" = false AND e."productId" IS NOT NULL
        GROUP BY e."productId" ORDER BY views DESC LIMIT 15
      `),
      this.prisma.$queryRaw<Array<Record<string, unknown>>>(Prisma.sql`
        SELECT COUNT(DISTINCT s."visitorId") AS visitors,
               COUNT(*) AS sessions,
               COALESCE(SUM(s."pageviews"), 0) AS pageviews,
               COALESCE(SUM(s."productViews"), 0) AS "productViews",
               COUNT(*) FILTER (WHERE NOT s."isNewVisitor") AS "returningSessions"
        FROM "analytics_sessions" s
        WHERE s."startedAt" >= ${from} AND s."startedAt" < ${to} AND s."isBot" = false AND s."sourceCategory" = 'AI'
      `),
    ]);
    const productIds = (products as Array<{ productId: string }>).map((p) => p.productId);
    const names = await this.productNames(productIds);
    return {
      totals: mapRows(totals)[0] ?? {},
      sources,
      landingPages: mapRows(landingPages),
      products: mapRows(products).map((p) => ({ ...p, name: names.get(p.productId as string) ?? p.productId })),
    };
  }

  // ─── Campaigns ─────────────────────────────────────────────────────

  async campaigns({ from, to }: ReportRange) {
    const rows = await this.prisma.$queryRaw<Array<Record<string, unknown>>>(Prisma.sql`
      WITH sess AS (
        SELECT s.* FROM "analytics_sessions" s
        WHERE s."startedAt" >= ${from} AND s."startedAt" < ${to} AND s."isBot" = false AND s."campaign" IS NOT NULL
      ),
      conv AS (
        SELECT e."visitorId",
               COUNT(*) FILTER (WHERE e."name" = 'signup_completed') AS signups,
               COUNT(*) FILTER (WHERE e."name" = 'purchase') AS purchases,
               COALESCE(SUM(CASE WHEN e."name" = 'purchase' THEN (e."props"->>'amount')::numeric ELSE 0 END), 0) AS revenue
        FROM "analytics_events" e
        WHERE e."ts" >= ${from} AND e."ts" < ${to} AND e."name" IN ('signup_completed','purchase')
        GROUP BY e."visitorId"
      )
      SELECT sess."campaign", sess."source", sess."medium",
             COUNT(DISTINCT sess."visitorId") AS visitors, COUNT(*) AS sessions,
             COALESCE(SUM(sess."productViews"), 0) AS "productViews",
             COALESCE(SUM(conv.signups), 0) AS signups,
             COALESCE(SUM(conv.purchases), 0) AS purchases,
             COALESCE(SUM(conv.revenue), 0) AS revenue
      FROM sess LEFT JOIN conv ON conv."visitorId" = sess."visitorId"
      GROUP BY sess."campaign", sess."source", sess."medium"
      ORDER BY sessions DESC LIMIT 100
    `);
    return mapRows(rows);
  }

  // ─── Pages ─────────────────────────────────────────────────────────

  async pages({ from, to }: ReportRange) {
    const [views, entries] = await Promise.all([
      this.prisma.$queryRaw<Array<Record<string, unknown>>>(Prisma.sql`
        SELECT e."page",
               COUNT(*) FILTER (WHERE e."name" = 'page_view') AS views,
               COUNT(DISTINCT e."visitorId") AS visitors,
               COALESCE(SUM(CASE WHEN e."name" = 'page_engagement' THEN LEAST((e."props"->>'engagedMs')::int, 1800000) ELSE 0 END), 0) AS "engagedMs",
               COALESCE(AVG(CASE WHEN e."name" = 'page_engagement' THEN (e."props"->>'maxScroll')::int END), 0)::int AS "avgScrollPct"
        FROM "analytics_events" e
        WHERE e."ts" >= ${from} AND e."ts" < ${to} AND e."page" IS NOT NULL
          AND e."name" IN ('page_view', 'page_engagement')
        GROUP BY e."page" ORDER BY views DESC LIMIT 50
      `),
      this.prisma.$queryRaw<Array<Record<string, unknown>>>(Prisma.sql`
        SELECT s."entryPage" AS page, COUNT(*) AS entries,
               COUNT(*) FILTER (WHERE s."pageviews" <= 1 AND s."engagedMs" < 10000) AS bounces
        FROM "analytics_sessions" s
        WHERE s."startedAt" >= ${from} AND s."startedAt" < ${to} AND s."isBot" = false AND s."entryPage" IS NOT NULL
        GROUP BY s."entryPage" ORDER BY entries DESC LIMIT 50
      `),
    ]);
    const entryMap = new Map(mapRows(entries).map((e) => [e.page as string, e]));
    return mapRows(views).map((v) => {
      const entry = entryMap.get(v.page as string);
      const e = Number(entry?.entries ?? 0);
      const b = Number(entry?.bounces ?? 0);
      return { ...v, entries: e, bounceRate: e ? +((100 * b) / e).toFixed(1) : null };
    });
  }

  // ─── Products ──────────────────────────────────────────────────────

  async products({ from, to }: ReportRange) {
    const rows = await this.prisma.$queryRaw<Array<Record<string, unknown>>>(Prisma.sql`
      SELECT e."productId",
             COUNT(*) FILTER (WHERE e."name" = 'product_view') AS views,
             COUNT(DISTINCT e."visitorId") FILTER (WHERE e."name" = 'product_view') AS visitors,
             COUNT(*) FILTER (WHERE e."name" = 'add_to_cart') AS "addToCart",
             COUNT(*) FILTER (WHERE e."name" = 'wishlist_add') AS wishlists,
             COUNT(*) FILTER (WHERE e."name" = 'purchase') AS purchases
      FROM "analytics_events" e
      WHERE e."ts" >= ${from} AND e."ts" < ${to} AND e."productId" IS NOT NULL
      GROUP BY e."productId" ORDER BY views DESC LIMIT 50
    `);
    const mapped = mapRows(rows);
    const names = await this.productNames(mapped.map((r) => r.productId as string));
    return mapped.map((r) => ({ ...r, name: names.get(r.productId as string) ?? r.productId }));
  }

  /** Product × source matrix for the top products (spec §8). */
  async productSources({ from, to }: ReportRange) {
    const rows = await this.prisma.$queryRaw<Array<Record<string, unknown>>>(Prisma.sql`
      WITH top_products AS (
        SELECT e."productId" FROM "analytics_events" e
        WHERE e."ts" >= ${from} AND e."ts" < ${to} AND e."name" = 'product_view' AND e."productId" IS NOT NULL
        GROUP BY e."productId" ORDER BY COUNT(*) DESC LIMIT 10
      )
      SELECT e."productId", s."sourceCategory"::text AS category, s."source",
             COUNT(*) AS views, COUNT(DISTINCT e."visitorId") AS visitors
      FROM "analytics_events" e
      JOIN "analytics_sessions" s ON s."id" = e."sessionId"
      WHERE e."ts" >= ${from} AND e."ts" < ${to} AND e."name" = 'product_view'
        AND e."productId" IN (SELECT "productId" FROM top_products) AND s."isBot" = false
      GROUP BY e."productId", s."sourceCategory", s."source"
      ORDER BY e."productId", views DESC
    `);
    const mapped = mapRows(rows);
    const names = await this.productNames(mapped.map((r) => r.productId as string));
    return mapped.map((r) => ({ ...r, name: names.get(r.productId as string) ?? r.productId }));
  }

  // ─── Signups / funnel ──────────────────────────────────────────────

  async signups(range: ReportRange) {
    const { from, to } = range;
    const [byMethod, bySource, daily] = await Promise.all([
      this.prisma.$queryRaw<Array<Record<string, unknown>>>(Prisma.sql`
        SELECT COALESCE(e."props"->>'method', 'unknown') AS method, COUNT(*) AS signups
        FROM "analytics_events" e
        WHERE e."ts" >= ${from} AND e."ts" < ${to} AND e."name" = 'signup_completed'
        GROUP BY 1 ORDER BY signups DESC
      `),
      this.prisma.$queryRaw<Array<Record<string, unknown>>>(Prisma.sql`
        SELECT v."firstSource" AS source, v."firstSourceCategory"::text AS category,
               COUNT(DISTINCT v."id") AS visitors,
               COUNT(DISTINCT e."userId") AS signups
        FROM "analytics_visitors" v
        LEFT JOIN "analytics_events" e
          ON e."visitorId" = v."id" AND e."name" = 'signup_completed' AND e."ts" >= ${from} AND e."ts" < ${to}
        WHERE v."lastSeenAt" >= ${from} AND v."isBot" = false
        GROUP BY 1, 2 ORDER BY visitors DESC LIMIT 30
      `),
      this.prisma.$queryRaw<Array<Record<string, unknown>>>(Prisma.sql`
        SELECT DATE(e."ts") AS date, COUNT(*) AS signups
        FROM "analytics_events" e
        WHERE e."ts" >= ${from} AND e."ts" < ${to} AND e."name" = 'signup_completed'
        GROUP BY 1 ORDER BY 1
      `),
    ]);
    return {
      byMethod: mapRows(byMethod),
      bySource: mapRows(bySource).map((r) => ({
        ...r,
        signupRate: Number(r.visitors) ? +((100 * Number(r.signups)) / Number(r.visitors)).toFixed(2) : 0,
      })),
      daily: mapRows(daily).map((d) => ({ ...d, date: (d.date as Date).toISOString().slice(0, 10) })),
    };
  }

  async funnel({ from, to }: ReportRange) {
    const distinctByEvent = async (name: string) => {
      const rows = await this.prisma.webEvent.groupBy({
        by: ['visitorId'],
        where: { name, ts: { gte: from, lt: to } },
      });
      return rows.length;
    };
    const [visitors, viewedProduct, addedToCart, signedUp, startedCheckout, purchased] = await Promise.all([
      this.prisma.webSession.groupBy({ by: ['visitorId'], where: { startedAt: { gte: from, lt: to }, isBot: false } }).then((r) => r.length),
      this.prisma.webSession.groupBy({ by: ['visitorId'], where: { startedAt: { gte: from, lt: to }, isBot: false, productViews: { gt: 0 } } }).then((r) => r.length),
      distinctByEvent('add_to_cart'),
      distinctByEvent('signup_completed'),
      distinctByEvent('checkout_started'),
      distinctByEvent('purchase'),
    ]);
    const stages = [
      { stage: 'Visitors', count: visitors },
      { stage: 'Viewed a product', count: viewedProduct },
      { stage: 'Added to cart', count: addedToCart },
      { stage: 'Signed up', count: signedUp },
      { stage: 'Started checkout', count: startedCheckout },
      { stage: 'Purchased', count: purchased },
    ];
    return stages.map((s, i) => ({
      ...s,
      pctOfPrevious: i === 0 || !stages[i - 1].count ? null : +((100 * s.count) / stages[i - 1].count).toFixed(1),
    }));
  }

  // ─── Audience ──────────────────────────────────────────────────────

  async geography({ from, to }: ReportRange) {
    const rows = await this.prisma.$queryRaw<Array<Record<string, unknown>>>(Prisma.sql`
      SELECT s."country", s."region", s."city",
             COUNT(DISTINCT s."visitorId") AS visitors, COUNT(*) AS sessions
      FROM "analytics_sessions" s
      WHERE s."startedAt" >= ${from} AND s."startedAt" < ${to} AND s."isBot" = false
      GROUP BY GROUPING SETS ((s."country"), (s."country", s."region"), (s."country", s."region", s."city"))
      ORDER BY sessions DESC LIMIT 120
    `);
    const mapped = mapRows(rows);
    return {
      countries: mapped.filter((r) => r.country && !r.region && !r.city),
      regions: mapped.filter((r) => r.country && r.region && !r.city).slice(0, 30),
      cities: mapped.filter((r) => r.country && r.region && r.city).slice(0, 30),
    };
  }

  async devices({ from, to }: ReportRange) {
    const dim = async (column: 'deviceType' | 'os' | 'browser') => {
      const rows = await this.prisma.$queryRaw<Array<Record<string, unknown>>>(Prisma.sql`
        WITH conv AS (
          SELECT e."visitorId", COUNT(*) FILTER (WHERE e."name" = 'signup_completed') AS signups,
                 COUNT(*) FILTER (WHERE e."name" = 'purchase') AS purchases
          FROM "analytics_events" e
          WHERE e."ts" >= ${from} AND e."ts" < ${to} AND e."name" IN ('signup_completed','purchase')
          GROUP BY e."visitorId"
        )
        SELECT s.${Prisma.raw(`"${column}"`)} AS value,
               COUNT(DISTINCT s."visitorId") AS visitors, COUNT(*) AS sessions,
               COALESCE(SUM(conv.signups), 0) AS signups, COALESCE(SUM(conv.purchases), 0) AS purchases
        FROM "analytics_sessions" s LEFT JOIN conv ON conv."visitorId" = s."visitorId"
        WHERE s."startedAt" >= ${from} AND s."startedAt" < ${to} AND s."isBot" = false
        GROUP BY 1 ORDER BY sessions DESC LIMIT 15
      `);
      return mapRows(rows).map((r) => ({
        ...r,
        signupRate: Number(r.visitors) ? +((100 * Number(r.signups)) / Number(r.visitors)).toFixed(2) : 0,
      }));
    };
    const [deviceTypes, os, browsers] = await Promise.all([dim('deviceType'), dim('os'), dim('browser')]);
    return { deviceTypes, os, browsers };
  }

  async retention({ from, to }: ReportRange) {
    // Visitor retention: of visitors first seen on day X, how many returned within D days.
    const cohorts = await this.prisma.$queryRaw<Array<Record<string, unknown>>>(Prisma.sql`
      WITH firsts AS (
        SELECT v."id", DATE_TRUNC('week', v."createdAt") AS cohort
        FROM "analytics_visitors" v
        WHERE v."createdAt" >= ${from} AND v."createdAt" < ${to} AND v."isBot" = false
      ),
      activity AS (
        SELECT s."visitorId", f.cohort,
               EXTRACT(DAY FROM s."startedAt" - f.cohort)::int AS day_offset
        FROM "analytics_sessions" s JOIN firsts f ON f."id" = s."visitorId"
      )
      SELECT f.cohort::date AS cohort,
             COUNT(DISTINCT f."id") AS size,
             COUNT(DISTINCT a."visitorId") FILTER (WHERE a.day_offset BETWEEN 1 AND 1) AS d1,
             COUNT(DISTINCT a."visitorId") FILTER (WHERE a.day_offset BETWEEN 1 AND 3) AS d3,
             COUNT(DISTINCT a."visitorId") FILTER (WHERE a.day_offset BETWEEN 1 AND 7) AS d7,
             COUNT(DISTINCT a."visitorId") FILTER (WHERE a.day_offset BETWEEN 1 AND 14) AS d14,
             COUNT(DISTINCT a."visitorId") FILTER (WHERE a.day_offset BETWEEN 1 AND 30) AS d30
      FROM firsts f LEFT JOIN activity a ON a.cohort = f.cohort
      GROUP BY 1 ORDER BY 1 DESC LIMIT 12
    `);
    return mapRows(cohorts);
  }

  // ─── Realtime / quality / search / events / health ─────────────────

  async realtime() {
    const since = new Date(Date.now() - 5 * 60 * 1000);
    const [active, pages, recent] = await Promise.all([
      this.prisma.webSession.groupBy({ by: ['visitorId'], where: { lastEventAt: { gte: since }, isBot: false } }),
      this.prisma.$queryRaw<Array<Record<string, unknown>>>(Prisma.sql`
        SELECT e."page", COUNT(DISTINCT e."visitorId") AS visitors
        FROM "analytics_events" e
        WHERE e."ts" >= ${since} AND e."page" IS NOT NULL
        GROUP BY 1 ORDER BY visitors DESC LIMIT 10
      `),
      this.prisma.webEvent.findMany({
        where: { ts: { gte: since } },
        orderBy: { ts: 'desc' },
        take: 30,
        select: { name: true, ts: true, page: true, productId: true },
      }),
    ]);
    return { activeVisitors: active.length, topPages: mapRows(pages), recentEvents: recent };
  }

  async quality({ from, to }: ReportRange) {
    const [human, bots, shortSessions, botFamilies] = await Promise.all([
      this.prisma.webSession.count({ where: { startedAt: { gte: from, lt: to }, isBot: false } }),
      this.prisma.webSession.count({ where: { startedAt: { gte: from, lt: to }, isBot: true } }),
      this.prisma.webSession.count({ where: { startedAt: { gte: from, lt: to }, isBot: false, pageviews: { lte: 1 }, engagedMs: { lt: 5000 } } }),
      this.prisma.$queryRaw<Array<Record<string, unknown>>>(Prisma.sql`
        SELECT s."browser" AS bot, COUNT(*) AS sessions
        FROM "analytics_sessions" s
        WHERE s."startedAt" >= ${from} AND s."startedAt" < ${to} AND s."isBot" = true
        GROUP BY 1 ORDER BY sessions DESC LIMIT 15
      `),
    ]);
    return {
      humanSessions: human,
      botSessions: bots,
      lowEngagementSessions: shortSessions,
      lowEngagementPct: human ? +((100 * shortSessions) / human).toFixed(1) : 0,
      botFamilies: mapRows(botFamilies),
    };
  }

  async searches({ from, to }: ReportRange) {
    const rows = await this.prisma.$queryRaw<Array<Record<string, unknown>>>(Prisma.sql`
      SELECT LOWER(e."props"->>'query') AS query,
             COUNT(*) AS searches,
             COUNT(DISTINCT e."visitorId") AS users,
             COUNT(*) FILTER (WHERE (e."props"->>'results')::int = 0) AS "zeroResults"
      FROM "analytics_events" e
      WHERE e."ts" >= ${from} AND e."ts" < ${to} AND e."name" = 'search' AND e."props"->>'query' IS NOT NULL
      GROUP BY 1 ORDER BY searches DESC LIMIT 50
    `);
    return mapRows(rows);
  }

  async eventCounts({ from, to }: ReportRange) {
    const rows = await this.prisma.webEvent.groupBy({
      by: ['name'],
      where: { ts: { gte: from, lt: to } },
      _count: true,
      orderBy: { _count: { name: 'desc' } },
    });
    return rows.map((r) => ({ name: r.name, count: r._count }));
  }

  async healthReport() {
    const dayAgo = new Date(Date.now() - 24 * 3600_000);
    const [eventsToday, unattributed, lastEvent] = await Promise.all([
      this.prisma.webEvent.count({ where: { ts: { gte: dayAgo } } }),
      this.prisma.webSession.count({ where: { startedAt: { gte: dayAgo }, sourceCategory: 'UNKNOWN' } }),
      this.prisma.webEvent.findFirst({ orderBy: { ts: 'desc' }, select: { ts: true, name: true } }),
    ]);
    return {
      eventsLast24h: eventsToday,
      unattributedSessionsLast24h: unattributed,
      lastEvent,
      sinceRestart: this.analytics.health,
    };
  }

  /** Journey for one user: attribution + chronological key events (spec §11/§32). */
  async userJourney(userId: string) {
    const [visitors, sessions, events] = await Promise.all([
      this.prisma.webVisitor.findMany({ where: { userId }, orderBy: { createdAt: 'asc' } }),
      this.prisma.webSession.findMany({ where: { userId }, orderBy: { startedAt: 'desc' }, take: 30 }),
      this.prisma.webEvent.findMany({
        where: { userId, name: { in: ['page_view', 'product_view', 'search', 'add_to_cart', 'signup_completed', 'login', 'checkout_started', 'purchase'] } },
        orderBy: { ts: 'desc' },
        take: 200,
        select: { name: true, ts: true, page: true, productId: true, props: true },
      }),
    ]);
    return { visitors, sessions, events };
  }

  private async productNames(ids: string[]): Promise<Map<string, string>> {
    if (!ids.length) return new Map();
    const products = await this.prisma.catalogProduct.findMany({
      where: { id: { in: ids.filter(Boolean) } },
      select: { id: true, name: true },
    });
    return new Map(products.map((p) => [p.id, p.name]));
  }
}

function previousPeriod({ from, to }: ReportRange): ReportRange {
  const span = to.getTime() - from.getTime();
  return { from: new Date(from.getTime() - span), to: from };
}
