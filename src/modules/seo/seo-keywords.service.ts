import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { KeywordType, SeoEntityType } from '@prisma/client';
import { PrismaService } from '../../database/prisma.service';
import { CreateKeywordDto, LinkKeywordDto, UpdateKeywordDto } from './seo.dto';

@Injectable()
export class SeoKeywordsService {
  constructor(private readonly prisma: PrismaService) {}

  async create(dto: CreateKeywordDto) {
    const name = dto.name.trim();
    const duplicate = await this.prisma.keywordEntity.findUnique({
      where: { name },
    });
    if (duplicate) throw new ConflictException(`Keyword "${name}" already exists`);

    if (dto.parentId) await this.assertParentExists(dto.parentId);

    return this.prisma.keywordEntity.create({
      data: {
        name,
        type: dto.type,
        canonicalName: dto.canonicalName?.trim() || null,
        synonyms: dto.synonyms ?? [],
        description: dto.description,
        parentId: dto.parentId ?? null,
        seasonStart: dto.seasonStart ? new Date(dto.seasonStart) : null,
        seasonEnd: dto.seasonEnd ? new Date(dto.seasonEnd) : null,
        isActive: dto.isActive ?? true,
      },
    });
  }

  async update(id: string, dto: UpdateKeywordDto) {
    const existing = await this.prisma.keywordEntity.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException('Keyword not found');

    if (dto.name !== undefined && dto.name.trim() !== existing.name) {
      const duplicate = await this.prisma.keywordEntity.findUnique({
        where: { name: dto.name.trim() },
      });
      if (duplicate) {
        throw new ConflictException(`Keyword "${dto.name.trim()}" already exists`);
      }
    }
    if (dto.parentId) {
      if (dto.parentId === id) {
        throw new ConflictException('A keyword cannot be its own parent');
      }
      await this.assertParentExists(dto.parentId);
    }

    return this.prisma.keywordEntity.update({
      where: { id },
      data: {
        ...(dto.name !== undefined && { name: dto.name.trim() }),
        ...(dto.type !== undefined && { type: dto.type }),
        ...(dto.canonicalName !== undefined && {
          canonicalName: dto.canonicalName.trim() || null,
        }),
        ...(dto.synonyms !== undefined && { synonyms: dto.synonyms }),
        ...(dto.description !== undefined && { description: dto.description }),
        ...(dto.parentId !== undefined && { parentId: dto.parentId || null }),
        ...(dto.seasonStart !== undefined && {
          seasonStart: dto.seasonStart ? new Date(dto.seasonStart) : null,
        }),
        ...(dto.seasonEnd !== undefined && {
          seasonEnd: dto.seasonEnd ? new Date(dto.seasonEnd) : null,
        }),
        ...(dto.isActive !== undefined && { isActive: dto.isActive }),
      },
    });
  }

  async remove(id: string) {
    const existing = await this.prisma.keywordEntity.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException('Keyword not found');
    return this.prisma.keywordEntity.delete({ where: { id } });
  }

  async list(params: { type?: KeywordType; search?: string; includeInactive?: boolean }) {
    return this.prisma.keywordEntity.findMany({
      where: {
        ...(params.type && { type: params.type }),
        ...(!params.includeInactive && { isActive: true }),
        ...(params.search && {
          OR: [
            { name: { contains: params.search, mode: 'insensitive' as const } },
            { synonyms: { has: params.search } },
          ],
        }),
      },
      include: { _count: { select: { links: true, children: true } } },
      orderBy: { name: 'asc' },
    });
  }

  async link(keywordId: string, dto: LinkKeywordDto) {
    const keyword = await this.prisma.keywordEntity.findUnique({
      where: { id: keywordId },
    });
    if (!keyword) throw new NotFoundException('Keyword not found');

    return this.prisma.keywordEntityLink.upsert({
      where: {
        keywordId_entityType_entityId: {
          keywordId,
          entityType: dto.entityType,
          entityId: dto.entityId,
        },
      },
      create: {
        keywordId,
        entityType: dto.entityType,
        entityId: dto.entityId,
        weight: dto.weight ?? 1,
      },
      update: { weight: dto.weight ?? 1 },
    });
  }

  async unlink(keywordId: string, entityType: SeoEntityType, entityId: string) {
    return this.prisma.keywordEntityLink.deleteMany({
      where: { keywordId, entityType, entityId },
    });
  }

  /** All entity links for one keyword, strongest first — the admin links UI. */
  async links(keywordId: string) {
    const keyword = await this.prisma.keywordEntity.findUnique({
      where: { id: keywordId },
    });
    if (!keyword) throw new NotFoundException('Keyword not found');
    return this.prisma.keywordEntityLink.findMany({
      where: { keywordId },
      orderBy: { weight: 'desc' },
    });
  }

  /** Active keywords linked to one entity, strongest first — internal-linking input. */
  async forEntity(entityType: SeoEntityType, entityId: string) {
    return this.prisma.keywordEntityLink.findMany({
      where: { entityType, entityId, keyword: { isActive: true } },
      include: { keyword: true },
      orderBy: { weight: 'desc' },
    });
  }

  private async assertParentExists(parentId: string) {
    const parent = await this.prisma.keywordEntity.findUnique({
      where: { id: parentId },
    });
    if (!parent) throw new NotFoundException('Parent keyword not found');
  }
}
