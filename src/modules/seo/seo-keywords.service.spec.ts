import { ConflictException, NotFoundException } from '@nestjs/common';
import { KeywordType, SeoEntityType } from '@prisma/client';
import { SeoKeywordsService } from './seo-keywords.service';

describe('SeoKeywordsService', () => {
  const prisma = {
    keywordEntity: {
      findUnique: jest.fn(),
      findMany: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
    },
    keywordEntityLink: {
      upsert: jest.fn(),
      deleteMany: jest.fn(),
      findMany: jest.fn(),
    },
  };
  const service = new SeoKeywordsService(prisma as never);

  beforeEach(() => {
    jest.clearAllMocks();
    prisma.keywordEntity.findUnique.mockResolvedValue(null);
  });

  it('rejects a duplicate keyword name', async () => {
    prisma.keywordEntity.findUnique.mockResolvedValue({ id: 'existing' });
    await expect(
      service.create({ name: 'Anime Collectibles', type: KeywordType.PRIMARY_TOPIC }),
    ).rejects.toThrow(ConflictException);
  });

  it('rejects a parentId that does not exist', async () => {
    prisma.keywordEntity.findUnique
      .mockResolvedValueOnce(null) // name-duplicate check
      .mockResolvedValueOnce(null); // parent lookup
    await expect(
      service.create({
        name: 'Scale Figures',
        type: KeywordType.SECONDARY_TOPIC,
        parentId: 'ghost',
      }),
    ).rejects.toThrow(NotFoundException);
  });

  it('link() upserts so re-linking is idempotent', async () => {
    prisma.keywordEntity.findUnique.mockResolvedValue({ id: 'kw-1' });
    prisma.keywordEntityLink.upsert.mockResolvedValue({});
    await service.link('kw-1', {
      entityType: SeoEntityType.PRODUCT,
      entityId: 'prod-1',
      weight: 3,
    });
    const args = prisma.keywordEntityLink.upsert.mock.calls[0][0];
    expect(args.where.keywordId_entityType_entityId).toEqual({
      keywordId: 'kw-1',
      entityType: SeoEntityType.PRODUCT,
      entityId: 'prod-1',
    });
    expect(args.create.weight).toBe(3);
    expect(args.update.weight).toBe(3);
  });

  it('links() returns every link for a keyword, strongest first', async () => {
    prisma.keywordEntity.findUnique.mockResolvedValue({ id: 'kw-1' });
    prisma.keywordEntityLink.findMany.mockResolvedValue([]);
    await service.links('kw-1');
    const args = prisma.keywordEntityLink.findMany.mock.calls[0][0];
    expect(args.where).toEqual({ keywordId: 'kw-1' });
    expect(args.orderBy).toEqual({ weight: 'desc' });
  });

  it('links() 404s when the keyword does not exist', async () => {
    prisma.keywordEntity.findUnique.mockResolvedValue(null);
    await expect(service.links('ghost')).rejects.toThrow(NotFoundException);
  });

  it('forEntity returns active keywords ordered by link weight', async () => {
    prisma.keywordEntityLink.findMany.mockResolvedValue([]);
    await service.forEntity(SeoEntityType.PRODUCT, 'prod-1');
    const args = prisma.keywordEntityLink.findMany.mock.calls[0][0];
    expect(args.where).toEqual({
      entityType: SeoEntityType.PRODUCT,
      entityId: 'prod-1',
      keyword: { isActive: true },
    });
    expect(args.orderBy).toEqual({ weight: 'desc' });
  });
});
