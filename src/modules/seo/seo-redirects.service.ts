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

  async list(params: { search?: string; page?: number; limit?: number }) {
    const page = Math.max(1, params.page ?? 1);
    const limit = Math.min(100, Math.max(1, params.limit ?? 50));
    const where = params.search
      ? {
          OR: [
            { fromPath: { contains: params.search.toLowerCase() } },
            { toPath: { contains: params.search.toLowerCase() } },
          ],
        }
      : undefined;

    const [total, items] = await this.prisma.$transaction([
      this.prisma.seoRedirect.count({ where }),
      this.prisma.seoRedirect.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
    ]);
    return { items, total, page, limit };
  }

  /** Flat map consumed by the buyer middleware, active rules only. */
  async getMap(): Promise<Record<string, { to: string; code: number }>> {
    const rows = await this.prisma.seoRedirect.findMany({
      where: { isActive: true },
      select: { fromPath: true, toPath: true, statusCode: true },
    });
    const map: Record<string, { to: string; code: number }> = {};
    for (const row of rows) {
      map[row.fromPath] = { to: row.toPath, code: row.statusCode };
    }
    return map;
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
