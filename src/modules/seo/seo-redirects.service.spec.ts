import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { SeoRedirectsService, normalizePath } from './seo-redirects.service';

describe('normalizePath', () => {
  it('lowercases, adds the leading slash, strips the trailing slash', () => {
    expect(normalizePath('Old-Page/')).toBe('/old-page');
    expect(normalizePath('/Old-Page')).toBe('/old-page');
    expect(normalizePath('/')).toBe('/');
  });

  it('reduces a full same-site URL to its path', () => {
    expect(normalizePath('https://yukizi.com/Old-Page/')).toBe('/old-page');
  });

  it('rejects empty input', () => {
    expect(() => normalizePath('   ')).toThrow(BadRequestException);
  });
});

describe('SeoRedirectsService', () => {
  const prisma = {
    seoRedirect: {
      findUnique: jest.fn(),
      findMany: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
      count: jest.fn(),
    },
    $transaction: jest.fn(),
  };
  const service = new SeoRedirectsService(prisma as never);

  beforeEach(() => {
    jest.clearAllMocks();
    prisma.$transaction.mockImplementation((ops: Promise<unknown>[]) => Promise.all(ops));
    prisma.seoRedirect.findMany.mockResolvedValue([]);
    prisma.seoRedirect.findUnique.mockResolvedValue(null);
  });

  describe('create', () => {
    it('stores normalized paths', async () => {
      prisma.seoRedirect.create.mockImplementation(({ data }: { data: unknown }) =>
        Promise.resolve(data),
      );
      await service.create({ fromPath: '/Old-URL/', toPath: '/New-URL/' });
      const data = prisma.seoRedirect.create.mock.calls[0][0].data;
      expect(data.fromPath).toBe('/old-url');
      expect(data.toPath).toBe('/new-url');
    });

    it('keeps an external toPath as a full URL', async () => {
      prisma.seoRedirect.create.mockImplementation(({ data }: { data: unknown }) =>
        Promise.resolve(data),
      );
      await service.create({ fromPath: '/out', toPath: 'https://example.com/page' });
      const data = prisma.seoRedirect.create.mock.calls[0][0].data;
      expect(data.toPath).toBe('https://example.com/page');
    });

    it('rejects a self-redirect', async () => {
      await expect(
        service.create({ fromPath: '/same', toPath: '/same' }),
      ).rejects.toThrow(ConflictException);
    });

    it('rejects a two-hop loop (A→B exists, creating B→A)', async () => {
      prisma.seoRedirect.findMany.mockResolvedValue([
        { fromPath: '/a', toPath: '/b' },
      ]);
      await expect(service.create({ fromPath: '/b', toPath: '/a' })).rejects.toThrow(
        ConflictException,
      );
    });

    it('rejects a duplicate fromPath', async () => {
      prisma.seoRedirect.findUnique.mockResolvedValue({ id: 'existing' });
      await expect(
        service.create({ fromPath: '/dup', toPath: '/target' }),
      ).rejects.toThrow(ConflictException);
    });
  });

  describe('update', () => {
    it('404s on a missing redirect', async () => {
      prisma.seoRedirect.findUnique.mockResolvedValue(null);
      await expect(service.update('nope', { toPath: '/x' })).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('getMap', () => {
    it('returns only active redirects as a flat map', async () => {
      prisma.seoRedirect.findMany.mockResolvedValue([
        { fromPath: '/a', toPath: '/b', statusCode: 301 },
        { fromPath: '/gone', toPath: '/', statusCode: 410 },
      ]);
      const map = await service.getMap();
      expect(map).toEqual({
        '/a': { to: '/b', code: 301 },
        '/gone': { to: '/', code: 410 },
      });
      const where = prisma.seoRedirect.findMany.mock.calls[0][0].where;
      expect(where.isActive).toBe(true);
    });
  });
});
