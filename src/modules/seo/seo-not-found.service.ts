import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';
import { SeoNotFoundStatus } from '@prisma/client';
import { normalizePath } from './seo-redirects.service';

/**
 * The 404 log.
 *
 * Without this, a broken URL is only discovered when Search Console reports it
 * — typically weeks after the link rotted, and only for pages Google happened
 * to recrawl. Recording them as they happen turns "somebody will tell us
 * eventually" into a worklist ordered by how much traffic each one is losing.
 *
 * Deliberately one row per path with a counter, not an event log: the volume
 * is driven by bots probing /wp-login.php and friends, and an append-only
 * table of that would be all cost and no signal.
 */
@Injectable()
export class SeoNotFoundService {
  private readonly logger = new Logger(SeoNotFoundService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Record a 404. Called from the storefront on its not-found boundary, so it
   * must never throw back at a page that is already failing — the caller
   * fire-and-forgets, and this swallows everything.
   */
  async record(input: {
    path: string;
    referrer?: string | null;
    userAgent?: string | null;
  }): Promise<void> {
    let path: string;
    try {
      path = normalizePath(input.path);
    } catch {
      return; // unparseable path: nothing useful to record
    }
    // Bounded so a long query string or a hostile UA string can't bloat rows.
    const referrer = input.referrer?.slice(0, 500) || null;
    const userAgent = input.userAgent?.slice(0, 300) || null;

    try {
      await this.prisma.seoNotFound.upsert({
        where: { path },
        create: { path, lastReferrer: referrer, lastUserAgent: userAgent },
        update: {
          hits: { increment: 1 },
          lastSeenAt: new Date(),
          lastReferrer: referrer,
          lastUserAgent: userAgent,
          // A path marked FIXED that 404s again is genuinely broken again —
          // surface it. IGNORED stays ignored: that was a deliberate call.
          ...(await this.shouldReopen(path)),
        },
      });
    } catch (err) {
      this.logger.warn(
        `Could not record 404 for ${path}: ${err instanceof Error ? err.message : 'unknown'}`,
      );
    }
  }

  private async shouldReopen(path: string): Promise<{ status?: SeoNotFoundStatus }> {
    const existing = await this.prisma.seoNotFound.findUnique({
      where: { path },
      select: { status: true },
    });
    return existing?.status === SeoNotFoundStatus.FIXED
      ? { status: SeoNotFoundStatus.NEW }
      : {};
  }

  async list(params: {
    status?: SeoNotFoundStatus;
    search?: string;
    sort?: 'hits' | 'recent' | 'oldest';
    page?: number;
    limit?: number;
  }) {
    const page = Math.max(1, params.page ?? 1);
    const limit = Math.min(200, Math.max(1, params.limit ?? 50));

    const where = {
      ...(params.status && { status: params.status }),
      ...(params.search && {
        path: { contains: params.search.toLowerCase() },
      }),
    };

    // Default is hits desc: the most-requested dead URL is the one costing
    // the most, which is the order somebody working through this wants.
    const orderBy =
      params.sort === 'recent'
        ? { lastSeenAt: 'desc' as const }
        : params.sort === 'oldest'
          ? { firstSeenAt: 'asc' as const }
          : { hits: 'desc' as const };

    const [total, items] = await this.prisma.$transaction([
      this.prisma.seoNotFound.count({ where }),
      this.prisma.seoNotFound.findMany({
        where,
        orderBy,
        skip: (page - 1) * limit,
        take: limit,
      }),
    ]);
    return { items, total, page, limit };
  }

  async setStatus(id: string, status: SeoNotFoundStatus) {
    const existing = await this.prisma.seoNotFound.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException('404 record not found');
    return this.prisma.seoNotFound.update({ where: { id }, data: { status } });
  }

  async remove(id: string) {
    const existing = await this.prisma.seoNotFound.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException('404 record not found');
    return this.prisma.seoNotFound.delete({ where: { id } });
  }

  /** Clear out everything already dealt with. Returns how many went. */
  async clearResolved(): Promise<{ deleted: number }> {
    const { count } = await this.prisma.seoNotFound.deleteMany({
      where: { status: { in: [SeoNotFoundStatus.FIXED, SeoNotFoundStatus.IGNORED] } },
    });
    return { deleted: count };
  }

  /**
   * Mark paths FIXED because a redirect now covers them. Called after a
   * redirect is created or imported, so the 404 list empties itself as the
   * work gets done instead of needing to be tidied by hand.
   */
  async markFixed(paths: string[]): Promise<void> {
    if (!paths.length) return;
    try {
      await this.prisma.seoNotFound.updateMany({
        where: { path: { in: paths }, status: { not: SeoNotFoundStatus.IGNORED } },
        data: { status: SeoNotFoundStatus.FIXED },
      });
    } catch (err) {
      // Never fail redirect creation over bookkeeping.
      this.logger.warn(
        `Could not mark 404s fixed: ${err instanceof Error ? err.message : 'unknown'}`,
      );
    }
  }

  /** Counters for the admin header. */
  async summary() {
    const [newCount, totalHits, fixed, ignored] = await this.prisma.$transaction([
      this.prisma.seoNotFound.count({ where: { status: SeoNotFoundStatus.NEW } }),
      this.prisma.seoNotFound.aggregate({
        where: { status: SeoNotFoundStatus.NEW },
        _sum: { hits: true },
      }),
      this.prisma.seoNotFound.count({ where: { status: SeoNotFoundStatus.FIXED } }),
      this.prisma.seoNotFound.count({ where: { status: SeoNotFoundStatus.IGNORED } }),
    ]);
    return {
      unresolved: newCount,
      unresolvedHits: totalHits._sum.hits ?? 0,
      fixed,
      ignored,
    };
  }
}
