import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, SeoEntityType } from '@prisma/client';
import { PrismaService } from '../../database/prisma.service';
import {
  ScorableMeta,
  computeAiVisibilityScore,
  computeReadabilityScore,
  computeSeoScore,
} from './seo-scoring';
import { ListSeoMetaQueryDto, UpsertSeoMetaDto } from './seo.dto';

/** The admin-editable scalar fields — also what a revision restore brings back. */
const EDITABLE_FIELDS = [
  'title',
  'description',
  'canonicalUrl',
  'ogTitle',
  'ogDescription',
  'ogImageUrl',
  'twitterCard',
  'robots',
  'focusKeyword',
  'secondaryKeywords',
  'entityDescription',
  'aiSummary',
  'faq',
  'structuredDataOverride',
  'imageAltOverrides',
] as const;

@Injectable()
export class SeoService {
  constructor(private readonly prisma: PrismaService) {}

  /** Public read. Null when no override exists — callers merge fail-open. */
  async getMeta(entityType: SeoEntityType, entityId: string) {
    return this.prisma.seoMeta.findUnique({
      where: { entityType_entityId: { entityType, entityId } },
    });
  }

  async upsertMeta(dto: UpsertSeoMetaDto, userId?: string) {
    const { entityType, entityId, ...raw } = dto;
    const fields = this.normalizeFields(raw);

    const existing = await this.prisma.seoMeta.findUnique({
      where: { entityType_entityId: { entityType, entityId } },
    });

    const scores = this.computeScores({ ...(existing ?? {}), ...fields });

    if (existing) {
      const [, updated] = await this.prisma.$transaction([
        this.prisma.seoMetaRevision.create({
          data: {
            seoMetaId: existing.id,
            snapshot: JSON.parse(JSON.stringify(existing)) as Prisma.InputJsonValue,
            changedById: userId ?? null,
          },
        }),
        this.prisma.seoMeta.update({
          where: { id: existing.id },
          data: { ...fields, ...scores, updatedById: userId ?? null },
        }),
      ]);
      return updated;
    }

    return this.prisma.seoMeta.create({
      data: {
        entityType,
        entityId,
        ...fields,
        ...scores,
        updatedById: userId ?? null,
      } as Prisma.SeoMetaUncheckedCreateInput,
    });
  }

  async listMeta(query: ListSeoMetaQueryDto) {
    const page = Math.max(1, query.page ?? 1);
    const limit = Math.min(100, Math.max(1, query.limit ?? 20));

    const where: Prisma.SeoMetaWhereInput = {
      ...(query.type && { entityType: query.type }),
      ...(query.missing && { [query.missing]: null }),
      ...(query.search && {
        OR: [
          { entityId: { contains: query.search, mode: 'insensitive' as const } },
          { title: { contains: query.search, mode: 'insensitive' as const } },
        ],
      }),
    };

    const [total, items] = await this.prisma.$transaction([
      this.prisma.seoMeta.count({ where }),
      this.prisma.seoMeta.findMany({
        where,
        orderBy: { updatedAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
    ]);

    return { items, total, page, limit };
  }

  async getRevisions(seoMetaId: string) {
    const meta = await this.prisma.seoMeta.findUnique({ where: { id: seoMetaId } });
    if (!meta) throw new NotFoundException('SEO meta record not found');
    return this.prisma.seoMetaRevision.findMany({
      where: { seoMetaId },
      orderBy: { createdAt: 'desc' },
      take: 50,
    });
  }

  async restoreRevision(seoMetaId: string, revisionId: string, userId?: string) {
    const meta = await this.prisma.seoMeta.findUnique({ where: { id: seoMetaId } });
    if (!meta) throw new NotFoundException('SEO meta record not found');

    const revision = await this.prisma.seoMetaRevision.findUnique({
      where: { id: revisionId },
    });
    if (!revision || revision.seoMetaId !== seoMetaId) {
      throw new NotFoundException('Revision not found');
    }

    const snapshot = revision.snapshot as Record<string, unknown>;
    const fields: Record<string, unknown> = {};
    for (const key of EDITABLE_FIELDS) {
      if (key in snapshot) fields[key] = snapshot[key];
    }
    const scores = this.computeScores({ ...meta, ...fields });

    const [, updated] = await this.prisma.$transaction([
      this.prisma.seoMetaRevision.create({
        data: {
          seoMetaId,
          snapshot: JSON.parse(JSON.stringify(meta)) as Prisma.InputJsonValue,
          changedById: userId ?? null,
        },
      }),
      this.prisma.seoMeta.update({
        where: { id: seoMetaId },
        data: { ...fields, ...scores, updatedById: userId ?? null },
      }),
    ]);
    return updated;
  }

  /** Trim strings; store '' as null so `missing=` coverage filters stay truthful. */
  private normalizeFields(
    raw: Omit<UpsertSeoMetaDto, 'entityType' | 'entityId'>,
  ): Record<string, unknown> {
    const out: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(raw)) {
      if (value === undefined) continue;
      if (typeof value === 'string') {
        const trimmed = value.trim();
        out[key] = trimmed === '' ? null : trimmed;
      } else {
        out[key] = value;
      }
    }
    return out;
  }

  private computeScores(merged: Record<string, unknown>) {
    const scorable = merged as ScorableMeta;
    return {
      seoScore: computeSeoScore(scorable),
      aiVisibilityScore: computeAiVisibilityScore(scorable),
      readabilityScore: computeReadabilityScore(scorable),
    };
  }
}
