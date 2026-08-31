import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';
import { CreateRedirectDto, UpdateRedirectDto } from './seo.dto';

/** "/Old-Page/" → "/old-page"; a full same-site URL is reduced to its path. */
export function normalizePath(input: string): string {
  let p = (input ?? '').trim();
  if (!p) throw new BadRequestException('Path is required');
  if (/^https?:\/\//i.test(p)) {
    try {
      p = new URL(p).pathname;
    } catch {
      throw new BadRequestException(`Not a valid URL or path: ${input}`);
    }
  }
  if (!p.startsWith('/')) p = `/${p}`;
  p = p.toLowerCase();
  if (p.length > 1 && p.endsWith('/')) p = p.slice(0, -1);
  return p;
}

/** External targets stay full URLs; internal targets get path normalization. */
function normalizeTarget(input: string): string {
  const t = (input ?? '').trim();
  if (!t) throw new BadRequestException('toPath is required');
  if (/^https?:\/\//i.test(t)) {
    try {
      const url = new URL(t);
      // Same-site absolute URLs are stored as bare paths so loop detection works.
      if (/(^|\.)yukizi\.com$/i.test(url.hostname)) return normalizePath(t);
      return t;
    } catch {
      throw new BadRequestException(`Not a valid URL: ${input}`);
    }
  }
  return normalizePath(t);
}

/**
 * Wildcard rules, for moving a whole section at once.
 *
 *   /old-section/*  ->  /new-section/*     keeps the tail: /old-section/a/b
 *                                          becomes /new-section/a/b
 *   /old-section/*  ->  /new-section       collapses everything onto one page
 *
 * Without these, retiring a section means one row per URL, which nobody does,
 * so the URLs quietly 404 instead.
 */
export const WILDCARD_SUFFIX = '/*';

export function isWildcardPath(path: string): boolean {
  return path.endsWith(WILDCARD_SUFFIX);
}

/** "/old/*" -> "/old". The prefix a request path must start with. */
export function wildcardPrefix(path: string): string {
  return path.slice(0, -WILDCARD_SUFFIX.length) || '/';
}

/**
 * Resolve a wildcard rule against a concrete path. Returns null when the rule
 * does not apply, so callers can keep looking.
 */
export function applyWildcard(
  rule: { fromPath: string; toPath: string },
  path: string,
): string | null {
  const prefix = wildcardPrefix(rule.fromPath);
  // The prefix itself must not match: /old/* covers what is under /old, and a
  // separate exact rule should own /old.
  if (!path.startsWith(prefix + '/')) return null;
  const tail = path.slice(prefix.length); // includes the leading slash
  if (!isWildcardPath(rule.toPath)) return rule.toPath;
  const targetPrefix = wildcardPrefix(rule.toPath);
  return targetPrefix === '/' ? tail : `${targetPrefix}${tail}`;
}

/**
 * A wildcard source needs a sane target, and must not swallow its own
 * destination. `/shop/*` -> `/shop/manga/*` would send /shop/a to /shop/manga/a,
 * which the wildcard then matches again — a loop the flat chain walk cannot
 * see, because neither path is a literal key.
 */
function assertWildcardShape(fromPath: string, toPath: string): void {
  const fromWild = isWildcardPath(fromPath);
  const toWild = isWildcardPath(toPath);

  if (!fromWild && toWild) {
    throw new BadRequestException(
      'Only a wildcard source can have a wildcard destination. Use /old/* -> /new/* to move a whole section.',
    );
  }
  if (fromPath.includes('*') && !fromWild) {
    throw new BadRequestException(
      'A * is only allowed at the end, as /section/*. Partial matches are not supported.',
    );
  }
  if (!fromWild) return;

  const fromPrefix = wildcardPrefix(fromPath);
  const toPrefix = toWild ? wildcardPrefix(toPath) : toPath;
  if (/^https?:\/\//i.test(toPath)) return; // off-site, cannot loop back here

  if (toPrefix === fromPrefix) {
    throw new ConflictException('A wildcard cannot redirect a section to itself');
  }
  if (toPrefix.startsWith(fromPrefix + '/')) {
    throw new ConflictException(
      `This sends ${fromPrefix} into ${toPrefix}, which the same rule would then match again — an endless redirect.`,
    );
  }
}

const MAX_CHAIN_HOPS = 20;

@Injectable()
export class SeoRedirectsService {
  constructor(private readonly prisma: PrismaService) {}

  async create(dto: CreateRedirectDto) {
    const fromPath = normalizePath(dto.fromPath);
    const toPath = normalizeTarget(dto.toPath);

    const duplicate = await this.prisma.seoRedirect.findUnique({
      where: { fromPath },
    });
    if (duplicate) {
      throw new ConflictException(`A redirect from ${fromPath} already exists`);
    }
    assertWildcardShape(fromPath, toPath);
    await this.assertNoLoop(fromPath, toPath);

    return this.prisma.seoRedirect.create({
      data: {
        fromPath,
        toPath,
        statusCode: dto.statusCode ?? 301,
        isActive: dto.isActive ?? true,
        note: dto.note,
      },
    });
  }

  async update(id: string, dto: UpdateRedirectDto) {
    const existing = await this.prisma.seoRedirect.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException('Redirect not found');

    const fromPath =
      dto.fromPath !== undefined ? normalizePath(dto.fromPath) : existing.fromPath;
    const toPath =
      dto.toPath !== undefined ? normalizeTarget(dto.toPath) : existing.toPath;

    if (fromPath !== existing.fromPath) {
      const duplicate = await this.prisma.seoRedirect.findUnique({
        where: { fromPath },
      });
      if (duplicate) {
        throw new ConflictException(`A redirect from ${fromPath} already exists`);
      }
    }
    assertWildcardShape(fromPath, toPath);
    await this.assertNoLoop(fromPath, toPath, id);

    return this.prisma.seoRedirect.update({
      where: { id },
      data: {
        fromPath,
        toPath,
        ...(dto.statusCode !== undefined && { statusCode: dto.statusCode }),
        ...(dto.isActive !== undefined && { isActive: dto.isActive }),
        ...(dto.note !== undefined && { note: dto.note }),
      },
    });
  }

  async remove(id: string) {
    const existing = await this.prisma.seoRedirect.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException('Redirect not found');
    return this.prisma.seoRedirect.delete({ where: { id } });
  }

  async list(params: {
    search?: string;
    page?: number;
    limit?: number;
    isActive?: boolean;
    statusCode?: number;
    sort?: 'recent' | 'hits' | 'path';
  }) {
    const page = Math.max(1, params.page ?? 1);
    const limit = Math.min(100, Math.max(1, params.limit ?? 50));
    const where = {
      ...(params.search && {
        OR: [
          { fromPath: { contains: params.search.toLowerCase() } },
          { toPath: { contains: params.search.toLowerCase() } },
        ],
      }),
      ...(params.isActive !== undefined && { isActive: params.isActive }),
      ...(params.statusCode !== undefined && { statusCode: params.statusCode }),
    };

    const orderBy =
      params.sort === 'hits'
        ? { hits: 'desc' as const }
        : params.sort === 'path'
          ? { fromPath: 'asc' as const }
          : { createdAt: 'desc' as const };

    const [total, items] = await this.prisma.$transaction([
      this.prisma.seoRedirect.count({ where }),
      this.prisma.seoRedirect.findMany({
        where,
        orderBy,
        skip: (page - 1) * limit,
        take: limit,
      }),
    ]);
    return { items, total, page, limit };
  }

  /** Every rule, oldest first — for CSV export. */
  async exportAll() {
    return this.prisma.seoRedirect.findMany({ orderBy: { createdAt: 'asc' } });
  }

  /**
   * Record that a rule fired.
   *
   * `hits` and `lastHitAt` have existed — and been displayed in admin — since
   * redirects shipped, but nothing ever wrote to them, so every rule read 0
   * forever. The storefront middleware now reports each redirect it serves.
   *
   * Best-effort by definition: the visitor has already been redirected by the
   * time this runs, so a failure here must never surface as an error.
   */
  async recordHit(path: string): Promise<void> {
    let fromPath: string;
    try {
      fromPath = normalizePath(path);
    } catch {
      return;
    }
    try {
      await this.prisma.seoRedirect.updateMany({
        where: { fromPath },
        data: { hits: { increment: 1 }, lastHitAt: new Date() },
      });
    } catch {
      // counting is never worth an error
    }
  }

  /**
   * Answer "what actually happens if I visit this URL?" — which the admin UI
   * could not previously answer without opening a browser.
   *
   * Follows the chain the way the storefront does, so a two-hop chain reads as
   * two hops instead of looking like one direct rule. An inactive rule is
   * reported as inactive rather than silently skipped, because "I made a
   * redirect and it isn't working" is almost always a switched-off rule.
   */
  async resolve(inputPath: string) {
    const path = normalizePath(inputPath);
    const rows = await this.prisma.seoRedirect.findMany({
      select: { fromPath: true, toPath: true, statusCode: true, isActive: true },
    });
    const byPath = new Map(rows.map((r) => [r.fromPath, r]));

    // Wildcards, longest prefix first — the storefront resolves them the same
    // way, and the tester is worthless if it disagrees with production.
    const activeWildcards = rows
      .filter((r) => r.isActive && isWildcardPath(r.fromPath))
      .sort((a, b) => wildcardPrefix(b.fromPath).length - wildcardPrefix(a.fromPath).length);

    /** Exact rule wins; otherwise the first covering wildcard. */
    const ruleFor = (p: string) => {
      const exact = byPath.get(p);
      if (exact) return { rule: exact, target: exact.toPath };
      for (const w of activeWildcards) {
        const target = applyWildcard(w, p);
        if (target) return { rule: w, target };
      }
      return null;
    };

    const first = byPath.get(path);
    if (!first && !ruleFor(path)) {
      return {
        path,
        outcome: 'no-redirect' as const,
        chain: [] as { from: string; to: string; statusCode: number }[],
        finalPath: path,
      };
    }
    if (first && !first.isActive && !this.hasActiveWildcard(activeWildcards, path)) {
      return {
        path,
        outcome: 'inactive' as const,
        chain: [] as { from: string; to: string; statusCode: number }[],
        finalPath: path,
        note: `A rule exists (${first.fromPath} to ${first.toPath}) but it is switched off, so visitors still get the original page or a 404.`,
      };
    }

    const chain: { from: string; to: string; statusCode: number }[] = [];
    const seen = new Set<string>([path]);
    let current = path;

    for (let hops = 0; hops < MAX_CHAIN_HOPS; hops++) {
      const match = ruleFor(current);
      if (!match || !match.rule.isActive) break;
      const { rule, target } = match;
      chain.push({ from: rule.fromPath, to: target, statusCode: rule.statusCode });
      current = target;
      if (seen.has(current)) {
        return { path, outcome: 'loop' as const, chain, finalPath: current };
      }
      seen.add(current);
      // An external target ends the walk — we cannot follow another site.
      if (/^https?:\/\//i.test(current)) break;
    }

    return {
      path,
      outcome: chain.length > 1 ? ('chain' as const) : ('redirect' as const),
      chain,
      finalPath: current,
    };
  }

  /**
   * Import many rules at once. Never all-or-nothing: a 300-row paste with two
   * bad lines applies the 298 good ones and reports the two, rather than
   * rejecting the lot and making someone hunt for the typo.
   */
  async bulkCreate(
    rows: { fromPath: string; toPath: string; statusCode?: number; note?: string }[],
  ) {
    const createdPaths: string[] = [];
    const failed: { fromPath: string; reason: string }[] = [];

    for (const row of rows) {
      try {
        const made = await this.create({
          fromPath: row.fromPath,
          toPath: row.toPath,
          statusCode: row.statusCode ?? 301,
          note: row.note,
        } as CreateRedirectDto);
        createdPaths.push(made.fromPath);
      } catch (err) {
        failed.push({
          fromPath: row.fromPath,
          reason: err instanceof Error ? err.message : 'Could not create',
        });
      }
    }
    return { created: createdPaths.length, failed, createdPaths };
  }

  async bulkSetActive(ids: string[], isActive: boolean) {
    const { count } = await this.prisma.seoRedirect.updateMany({
      where: { id: { in: ids } },
      data: { isActive },
    });
    return { updated: count };
  }

  async bulkRemove(ids: string[]) {
    const { count } = await this.prisma.seoRedirect.deleteMany({
      where: { id: { in: ids } },
    });
    return { deleted: count };
  }

  /** Flat map consumed by the buyer middleware, active rules only. */
  async getMap(): Promise<{
    exact: Record<string, { to: string; code: number }>;
    wildcards: { from: string; to: string; code: number }[];
  }> {
    const rows = await this.prisma.seoRedirect.findMany({
      where: { isActive: true },
      select: { fromPath: true, toPath: true, statusCode: true },
    });
    const exact: Record<string, { to: string; code: number }> = {};
    const wildcards: { from: string; to: string; code: number }[] = [];
    for (const row of rows) {
      if (isWildcardPath(row.fromPath)) {
        wildcards.push({ from: row.fromPath, to: row.toPath, code: row.statusCode });
      } else {
        exact[row.fromPath] = { to: row.toPath, code: row.statusCode };
      }
    }
    // Longest prefix first, so /shop/manga/* beats /shop/* for a manga URL.
    wildcards.sort((a, b) => wildcardPrefix(b.from).length - wildcardPrefix(a.from).length);
    return { exact, wildcards };
  }

  /** First wildcard rule that covers `path`, or null. */
  private matchWildcard(
    wildcards: { from: string; to: string; code: number }[],
    path: string,
  ): { rule: { from: string; to: string; code: number }; target: string } | null {
    for (const rule of wildcards) {
      const target = applyWildcard({ fromPath: rule.from, toPath: rule.to }, path);
      if (target) return { rule, target };
    }
    return null;
  }

  private hasActiveWildcard(
    wildcards: { fromPath: string; toPath: string }[],
    path: string,
  ): boolean {
    return wildcards.some((w) => applyWildcard(w, path) !== null);
  }

  /** Walk the chain starting at toPath; adding this rule must never reach fromPath. */
  private async assertNoLoop(fromPath: string, toPath: string, ignoreId?: string) {
    if (fromPath === toPath) {
      throw new ConflictException('A redirect cannot point to itself');
    }
    const rows = await this.prisma.seoRedirect.findMany({
      where: { isActive: true, ...(ignoreId && { id: { not: ignoreId } }) },
      select: { fromPath: true, toPath: true },
    });
    const map = new Map(rows.map((r) => [r.fromPath, r.toPath]));
    map.set(fromPath, toPath);

    let current: string | undefined = toPath;
    for (let hops = 0; hops < MAX_CHAIN_HOPS; hops++) {
      current = map.get(current);
      if (current === undefined) return;
      if (current === fromPath) {
        throw new ConflictException(
          `This redirect creates a loop back to ${fromPath}`,
        );
      }
    }
    throw new ConflictException('This redirect creates a chain longer than 20 hops');
  }
}
