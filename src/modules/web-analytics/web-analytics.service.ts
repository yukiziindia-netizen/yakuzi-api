import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../database/prisma.service';
import { classifySource } from './source-classifier';
import { parseUa } from './ua';
import { CollectBatchDto } from './web-analytics.dto';

/**
 * First-party analytics ingestion + server-side truth events.
 *
 * Design constraints (single shared prod VM):
 *  - every write path is small and bounded; a batch is 3 upserts + 1 createMany
 *  - everything here fails soft: an analytics failure must never break a
 *    user-facing flow, so track()/identify() swallow and log
 *  - session rule (documented): a session ends after 30 min of inactivity;
 *    the client also starts a new session when a new UTM set arrives
 */

const MAX_EVENTS_PER_BATCH = 25;
const MAX_PROP_KEYS = 20;
const MAX_PROP_STRING = 500;
/** Reject client timestamps drifting more than this from server time. */
const MAX_CLOCK_DRIFT_MS = 6 * 60 * 60 * 1000;
/** Props keys that must never be stored, whatever the client sends. */
const PII_KEY = /pass|token|secret|auth|card|cvv|otp|email|phone|address/i;

const ENGAGEMENT_EVENT = 'page_engagement';

export interface ServerEventInput {
  name: string;
  userId?: string | null;
  visitorId?: string | null;
  productId?: string | null;
  page?: string | null;
  props?: Record<string, unknown>;
}

@Injectable()
export class WebAnalyticsService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(WebAnalyticsService.name);
  private rollupTimer: ReturnType<typeof setInterval> | null = null;
  /** In-memory health counters (reset on restart — reported as such). */
  readonly health = { received: 0, rejected: 0, errors: 0, lastEventAt: null as Date | null, lastRollupAt: null as Date | null };

  constructor(private readonly prisma: PrismaService) {}

  onModuleInit() {
    if (process.env.NODE_ENV === 'test' || process.env.JEST_WORKER_ID) return;
    // Rollup keeps the overview trend cheap; 15-min cadence, fire-and-forget.
    this.rollupTimer = setInterval(() => {
      void this.rollupRecentDays().catch((e) => this.logger.warn(`rollup failed: ${e?.message ?? e}`));
    }, 15 * 60 * 1000);
    setTimeout(() => void this.rollupRecentDays().catch(() => undefined), 30 * 1000);
  }

  onModuleDestroy() {
    if (this.rollupTimer) clearInterval(this.rollupTimer);
  }

  // ─── Ingestion (public collect endpoint) ───────────────────────────

  async ingest(batch: CollectBatchDto): Promise<void> {
    const now = new Date();
    const events = (batch.events ?? []).slice(0, MAX_EVENTS_PER_BATCH);
    this.health.received += events.length;

    const ua = parseUa(batch.ua);
    const utm = batch.session.utm ?? {};
    const classified = classifySource({
      referrer: batch.session.referrer,
      utmSource: utm.source,
      utmMedium: utm.medium,
      clickIds: batch.session.clickIds as never,
    });

    const visitorId = batch.visitor.id;
    const sessionId = batch.session.id;
    const userId = batch.userId ?? null;

    const existing = await this.prisma.webVisitor.findUnique({ where: { id: visitorId }, select: { id: true } });
    const isNewVisitor = !existing;

    const attribution = {
      source: classified.source,
      sourceCategory: classified.category,
      medium: utm.medium?.slice(0, 100) ?? null,
      campaign: utm.campaign?.slice(0, 200) ?? null,
      referrerDomain: classified.referrerDomain,
      attributionLevel: classified.level,
      landingPage: batch.session.landingPage?.slice(0, 500) ?? null,
    };

    const deviceGeo = {
      deviceType: ua.deviceType,
      os: ua.os,
      browser: ua.browser,
      country: batch.country ?? null,
      region: batch.region ?? null,
      city: batch.city ?? null,
    };

    const pageviewsInBatch = events.filter((e) => e.name === 'page_view').length;
    const productViewsInBatch = events.filter((e) => e.name === 'product_view').length;
    const engagedInBatch = events
      .filter((e) => e.name === ENGAGEMENT_EVENT)
      .reduce((sum, e) => sum + Math.min(Math.max(Number((e.props as { engagedMs?: unknown })?.engagedMs) || 0, 0), 30 * 60 * 1000), 0);
    const sessionIsNew = batch.session.isNew === true;

    if (isNewVisitor) {
      // First-touch attribution: written once, never overwritten afterwards.
      await this.prisma.webVisitor.create({
        data: {
          id: visitorId,
          userId,
          firstSource: attribution.source,
          firstSourceCategory: attribution.sourceCategory,
          firstMedium: attribution.medium,
          firstCampaign: attribution.campaign,
          firstReferrerDomain: attribution.referrerDomain,
          firstLandingPage: attribution.landingPage,
          firstAttributionLevel: attribution.attributionLevel,
          lastSource: attribution.source,
          lastSourceCategory: attribution.sourceCategory,
          lastCampaign: attribution.campaign,
          lastReferrerDomain: attribution.referrerDomain,
          lastLandingPage: attribution.landingPage,
          language: batch.visitor.language ?? null,
          timezone: batch.visitor.timezone ?? null,
          screenW: batch.visitor.screenW ?? null,
          screenH: batch.visitor.screenH ?? null,
          isBot: ua.isBot,
          ...deviceGeo,
        },
      });
    } else {
      await this.prisma.webVisitor.update({
        where: { id: visitorId },
        data: {
          lastSeenAt: now,
          ...(userId && { userId }),
          ...(sessionIsNew && {
            lastSource: attribution.source,
            lastSourceCategory: attribution.sourceCategory,
            lastCampaign: attribution.campaign,
            lastReferrerDomain: attribution.referrerDomain,
            lastLandingPage: attribution.landingPage,
          }),
          pageviewsCount: { increment: pageviewsInBatch },
          totalEngagedMs: { increment: engagedInBatch },
          ...deviceGeo,
        },
      });
    }

    // Session upsert: created on the first batch that carries this id.
    const sessionRow = await this.prisma.webSession.findUnique({ where: { id: sessionId }, select: { id: true, startedAt: true } });
    if (!sessionRow) {
      await this.prisma.webSession.create({
        data: {
          id: sessionId,
          visitorId,
          userId,
          entryPage: attribution.landingPage,
          exitPage: lastPage(events) ?? attribution.landingPage,
          pageviews: pageviewsInBatch,
          productViews: productViewsInBatch,
          events: events.length,
          engagedMs: engagedInBatch,
          source: attribution.source,
          sourceCategory: attribution.sourceCategory,
          medium: attribution.medium,
          campaign: attribution.campaign,
          utmTerm: utm.term?.slice(0, 200) ?? null,
          utmContent: utm.content?.slice(0, 200) ?? null,
          referrerDomain: attribution.referrerDomain,
          attributionLevel: attribution.attributionLevel,
          clickIds: batch.session.clickIds ? (batch.session.clickIds as Prisma.InputJsonValue) : Prisma.JsonNull,
          isNewVisitor,
          isBot: ua.isBot,
          ...deviceGeo,
        },
      });
      if (isNewVisitor) {
        await this.prisma.webVisitor.update({
          where: { id: visitorId },
          data: { sessionsCount: 1, pageviewsCount: pageviewsInBatch, totalEngagedMs: engagedInBatch },
        });
      } else {
        await this.prisma.webVisitor.update({ where: { id: visitorId }, data: { sessionsCount: { increment: 1 } } });
      }
    } else {
      await this.prisma.webSession.update({
        where: { id: sessionId },
        data: {
          lastEventAt: now,
          durationMs: now.getTime() - sessionRow.startedAt.getTime(),
          ...(lastPage(events) && { exitPage: lastPage(events) }),
          pageviews: { increment: pageviewsInBatch },
          productViews: { increment: productViewsInBatch },
          events: { increment: events.length },
          engagedMs: { increment: engagedInBatch },
          ...(userId && { userId }),
        },
      });
    }

    if (events.length) {
      await this.prisma.webEvent.createMany({
        data: events.map((e) => ({
          visitorId,
          sessionId,
          userId,
          name: sanitizeName(e.name),
          ts: boundTs(e.ts, now),
          page: e.page?.slice(0, 500) ?? null,
          productId: e.productId ?? null,
          props: sanitizeProps(e.props),
        })),
      });
      this.health.lastEventAt = now;
    }
  }

  // ─── Server-side truth events (called from auth/orders/payments) ───

  /**
   * Link an anonymous visitor to an account and record login/signup.
   * Signup vs login decided by account age so callers stay one-liners.
   */
  async identify(params: {
    visitorId?: string | null;
    userId: string;
    method: string;
    /** Pass when the caller knows (AuthResponse.isNewUser); falls back to account age. */
    isSignup?: boolean;
  }): Promise<void> {
    try {
      let isSignup = params.isSignup;
      if (isSignup === undefined) {
        const user = await this.prisma.user.findUnique({
          where: { id: params.userId },
          select: { createdAt: true },
        });
        if (!user) return;
        isSignup = Date.now() - user.createdAt.getTime() < 120_000;
      }

      if (params.visitorId) {
        await this.prisma.webVisitor
          .update({ where: { id: params.visitorId }, data: { userId: params.userId } })
          .catch(() => undefined); // visitor row may not exist (tracker blocked) — fine
        await this.prisma.webSession.updateMany({
          where: { visitorId: params.visitorId, userId: null, startedAt: { gte: new Date(Date.now() - 12 * 3600_000) } },
          data: { userId: params.userId },
        });
      }

      await this.track({
        name: isSignup ? 'signup_completed' : 'login',
        userId: params.userId,
        visitorId: params.visitorId,
        props: { method: params.method },
      });
    } catch (e) {
      this.logger.warn(`identify failed: ${(e as Error).message}`);
    }
  }

  /** Record a server-side event. Never throws. */
  async track(event: ServerEventInput): Promise<void> {
    try {
      let visitorId = event.visitorId ?? null;
      if (!visitorId && event.userId) {
        const v = await this.prisma.webVisitor.findFirst({
          where: { userId: event.userId },
          orderBy: { lastSeenAt: 'desc' },
          select: { id: true },
        });
        visitorId = v?.id ?? null;
      }
      await this.prisma.webEvent.create({
        data: {
          visitorId: visitorId ?? 'server',
          sessionId: null,
          userId: event.userId ?? null,
          name: sanitizeName(event.name),
          page: event.page ?? null,
          productId: event.productId ?? null,
          props: sanitizeProps(event.props),
        },
      });
      this.health.lastEventAt = new Date();
    } catch (e) {
      this.health.errors += 1;
      this.logger.warn(`track(${event.name}) failed: ${(e as Error).message}`);
    }
  }

  // ─── Daily rollup ──────────────────────────────────────────────────

  /** Upserts today's and yesterday's rows so restarts/timezones can't leave holes. */
  async rollupRecentDays(): Promise<void> {
    for (const offset of [1, 0]) {
      const day = new Date();
      day.setUTCDate(day.getUTCDate() - offset);
      await this.rollupDay(day);
    }
    this.health.lastRollupAt = new Date();
  }

  async rollupDay(day: Date): Promise<void> {
    const start = new Date(Date.UTC(day.getUTCFullYear(), day.getUTCMonth(), day.getUTCDate()));
    const end = new Date(start.getTime() + 24 * 3600_000);

    const rows = await this.prisma.$queryRaw<
      Array<{ key: string; visitors: bigint; newvisitors: bigint; sessions: bigint; pageviews: bigint; productviews: bigint }>
    >(Prisma.sql`
      SELECT "sourceCategory"::text AS key,
             COUNT(DISTINCT "visitorId") AS visitors,
             COUNT(*) FILTER (WHERE "isNewVisitor") AS newVisitors,
             COUNT(*) AS sessions,
             COALESCE(SUM("pageviews"), 0) AS pageviews,
             COALESCE(SUM("productViews"), 0) AS productViews
      FROM "analytics_sessions"
      WHERE "startedAt" >= ${start} AND "startedAt" < ${end} AND "isBot" = false
      GROUP BY "sourceCategory"
    `);

    const [signups, purchases] = await Promise.all([
      this.prisma.webEvent.count({ where: { name: 'signup_completed', ts: { gte: start, lt: end } } }),
      this.prisma.webEvent.findMany({
        where: { name: 'purchase', ts: { gte: start, lt: end } },
        select: { props: true },
      }),
    ]);
    const revenue = purchases.reduce((sum, p) => sum + (Number((p.props as { amount?: unknown })?.amount) || 0), 0);

    const totals = { visitors: 0, newVisitors: 0, sessions: 0, pageviews: 0, productViews: 0 };
    for (const r of rows) {
      totals.visitors += Number(r.visitors);
      totals.newVisitors += Number(r.newvisitors ?? 0);
      totals.sessions += Number(r.sessions);
      totals.pageviews += Number(r.pageviews);
      totals.productViews += Number(r.productviews);
    }

    const upserts: Prisma.PrismaPromise<unknown>[] = [
      this.prisma.webDailyStat.upsert({
        where: { date_kind_key: { date: start, kind: 'total', key: '' } },
        create: { date: start, kind: 'total', key: '', ...totals, signups, purchases: purchases.length, revenue },
        update: { ...totals, signups, purchases: purchases.length, revenue },
      }),
      ...rows.map((r) =>
        this.prisma.webDailyStat.upsert({
          where: { date_kind_key: { date: start, kind: 'source_category', key: r.key } },
          create: {
            date: start, kind: 'source_category', key: r.key,
            visitors: Number(r.visitors), newVisitors: Number(r.newvisitors ?? 0), sessions: Number(r.sessions),
            pageviews: Number(r.pageviews), productViews: Number(r.productviews),
          },
          update: {
            visitors: Number(r.visitors), newVisitors: Number(r.newvisitors ?? 0), sessions: Number(r.sessions),
            pageviews: Number(r.pageviews), productViews: Number(r.productviews),
          },
        }),
      ),
    ];
    await this.prisma.$transaction(upserts);
  }
}

function lastPage(events: Array<{ name: string; page?: string }>): string | null {
  for (let i = events.length - 1; i >= 0; i--) {
    if (events[i].page) return events[i].page!.slice(0, 500);
  }
  return null;
}

function sanitizeName(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9_]/g, '_').slice(0, 40);
}

function boundTs(clientTs: number | undefined, now: Date): Date {
  if (!clientTs) return now;
  const drift = Math.abs(now.getTime() - clientTs);
  return drift > MAX_CLOCK_DRIFT_MS ? now : new Date(clientTs);
}

function sanitizeProps(props?: Record<string, unknown>): Prisma.InputJsonValue | undefined {
  if (!props || typeof props !== 'object') return undefined;
  const out: Record<string, unknown> = {};
  let keys = 0;
  for (const [k, v] of Object.entries(props)) {
    if (keys >= MAX_PROP_KEYS) break;
    if (PII_KEY.test(k)) continue;
    if (typeof v === 'string') out[k] = v.slice(0, MAX_PROP_STRING);
    else if (typeof v === 'number' || typeof v === 'boolean' || v === null) out[k] = v;
    else continue; // no nested objects — keeps rows small and queries sane
    keys++;
  }
  return out as Prisma.InputJsonValue;
}
