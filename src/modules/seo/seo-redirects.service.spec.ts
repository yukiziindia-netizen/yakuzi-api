import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { SeoRedirectsService, normalizePath, applyWildcard } from './seo-redirects.service';

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
    it('returns only active redirects, exact matches keyed by path', async () => {
      prisma.seoRedirect.findMany.mockResolvedValue([
        { fromPath: '/a', toPath: '/b', statusCode: 301 },
        { fromPath: '/gone', toPath: '/', statusCode: 410 },
      ]);
      const { exact, wildcards } = await service.getMap();
      expect(exact).toEqual({
        '/a': { to: '/b', code: 301 },
        '/gone': { to: '/', code: 410 },
      });
      expect(wildcards).toEqual([]);
      const where = prisma.seoRedirect.findMany.mock.calls[0][0].where;
      expect(where.isActive).toBe(true);
    });
  });
});

describe('SeoRedirectsService — hit tracking, tester and bulk ops', () => {
  const prisma = {
    seoRedirect: {
      findUnique: jest.fn(),
      findMany: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      updateMany: jest.fn(),
      delete: jest.fn(),
      deleteMany: jest.fn(),
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
    prisma.seoRedirect.updateMany.mockResolvedValue({ count: 1 });
    prisma.seoRedirect.deleteMany.mockResolvedValue({ count: 0 });
  });

  describe('recordHit', () => {
    it('increments the counter for the normalized path', async () => {
      await service.recordHit('/Old-Page/');

      expect(prisma.seoRedirect.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { fromPath: '/old-page' } }),
      );
      const call = prisma.seoRedirect.updateMany.mock.calls[0][0];
      expect(call.data.hits).toEqual({ increment: 1 });
      expect(call.data.lastHitAt).toBeInstanceOf(Date);
    });

    it('never throws when the path is unusable', async () => {
      await expect(service.recordHit('   ')).resolves.toBeUndefined();
      expect(prisma.seoRedirect.updateMany).not.toHaveBeenCalled();
    });

    it('never throws when the database fails — the visitor was already redirected', async () => {
      prisma.seoRedirect.updateMany.mockRejectedValue(new Error('db down'));
      await expect(service.recordHit('/old')).resolves.toBeUndefined();
    });
  });

  describe('resolve', () => {
    it('reports no-redirect for an unmatched path', async () => {
      const res = await service.resolve('/nothing-here');
      expect(res.outcome).toBe('no-redirect');
      expect(res.finalPath).toBe('/nothing-here');
    });

    it('reports a single hop', async () => {
      prisma.seoRedirect.findMany.mockResolvedValue([
        { fromPath: '/a', toPath: '/b', statusCode: 301, isActive: true },
      ]);
      const res = await service.resolve('/a');
      expect(res.outcome).toBe('redirect');
      expect(res.finalPath).toBe('/b');
      expect(res.chain).toHaveLength(1);
    });

    it('follows a multi-hop chain and reports every hop', async () => {
      prisma.seoRedirect.findMany.mockResolvedValue([
        { fromPath: '/a', toPath: '/b', statusCode: 301, isActive: true },
        { fromPath: '/b', toPath: '/c', statusCode: 301, isActive: true },
      ]);
      const res = await service.resolve('/a');
      expect(res.outcome).toBe('chain');
      expect(res.finalPath).toBe('/c');
      expect(res.chain.map((h) => h.from)).toEqual(['/a', '/b']);
    });

    it('calls out a switched-off rule instead of pretending nothing exists', async () => {
      prisma.seoRedirect.findMany.mockResolvedValue([
        { fromPath: '/a', toPath: '/b', statusCode: 301, isActive: false },
      ]);
      const res = await service.resolve('/a');
      expect(res.outcome).toBe('inactive');
      expect(res.finalPath).toBe('/a');
    });

    it('detects a loop rather than walking forever', async () => {
      prisma.seoRedirect.findMany.mockResolvedValue([
        { fromPath: '/a', toPath: '/b', statusCode: 301, isActive: true },
        { fromPath: '/b', toPath: '/a', statusCode: 301, isActive: true },
      ]);
      const res = await service.resolve('/a');
      expect(res.outcome).toBe('loop');
    });

    it('stops at an external target instead of trying to follow it', async () => {
      prisma.seoRedirect.findMany.mockResolvedValue([
        { fromPath: '/a', toPath: 'https://example.com/x', statusCode: 301, isActive: true },
      ]);
      const res = await service.resolve('/a');
      expect(res.finalPath).toBe('https://example.com/x');
      expect(res.chain).toHaveLength(1);
    });
  });

  describe('bulkCreate', () => {
    it('applies the good rows and reports only the bad ones', async () => {
      // Second row duplicates an existing rule; the others are fine.
      prisma.seoRedirect.findUnique.mockImplementation(({ where }: any) =>
        Promise.resolve(where.fromPath === '/dupe' ? { id: 'x' } : null),
      );
      prisma.seoRedirect.create.mockImplementation(({ data }: any) =>
        Promise.resolve({ ...data, id: 'new' }),
      );

      const res = await service.bulkCreate([
        { fromPath: '/one', toPath: '/1' },
        { fromPath: '/dupe', toPath: '/2' },
        { fromPath: '/three', toPath: '/3' },
      ]);

      expect(res.created).toBe(2);
      expect(res.createdPaths).toEqual(['/one', '/three']);
      expect(res.failed).toHaveLength(1);
      expect(res.failed[0].fromPath).toBe('/dupe');
    });
  });

  describe('bulk activate / delete', () => {
    it('reports how many rows changed', async () => {
      prisma.seoRedirect.updateMany.mockResolvedValue({ count: 3 });
      await expect(service.bulkSetActive(['a', 'b', 'c'], false)).resolves.toEqual({
        updated: 3,
      });

      prisma.seoRedirect.deleteMany.mockResolvedValue({ count: 2 });
      await expect(service.bulkRemove(['a', 'b'])).resolves.toEqual({ deleted: 2 });
    });
  });
});

describe('wildcard redirects', () => {
  describe('applyWildcard', () => {
    it('keeps the tail when both sides are wildcards', () => {
      expect(applyWildcard({ fromPath: '/old/*', toPath: '/new/*' }, '/old/a/b')).toBe('/new/a/b');
    });

    it('collapses onto one page when the target has no wildcard', () => {
      expect(applyWildcard({ fromPath: '/old/*', toPath: '/new' }, '/old/a/b')).toBe('/new');
    });

    it('does not match the prefix itself — /old belongs to an exact rule', () => {
      expect(applyWildcard({ fromPath: '/old/*', toPath: '/new/*' }, '/old')).toBeNull();
    });

    it('does not match a path that merely starts with the same letters', () => {
      expect(applyWildcard({ fromPath: '/old/*', toPath: '/new/*' }, '/older/thing')).toBeNull();
    });

    it('handles a root wildcard target', () => {
      expect(applyWildcard({ fromPath: '/shop/*', toPath: '/*' }, '/shop/manga')).toBe('/manga');
    });
  });

  describe('getMap', () => {
    const prisma = {
      seoRedirect: { findMany: jest.fn() },
    };
    const service = new SeoRedirectsService(prisma as never);

    it('separates wildcards and orders them longest-prefix first', async () => {
      prisma.seoRedirect.findMany.mockResolvedValue([
        { fromPath: '/shop/*', toPath: '/c/*', statusCode: 301 },
        { fromPath: '/a', toPath: '/b', statusCode: 301 },
        { fromPath: '/shop/manga/*', toPath: '/c/manga/*', statusCode: 301 },
      ]);

      const { exact, wildcards } = await service.getMap();

      expect(exact).toEqual({ '/a': { to: '/b', code: 301 } });
      // Longest first, so a manga URL is not swallowed by the broader rule.
      expect(wildcards.map((w) => w.from)).toEqual(['/shop/manga/*', '/shop/*']);
    });
  });

  describe('validation', () => {
    const prisma = {
      seoRedirect: {
        findUnique: jest.fn().mockResolvedValue(null),
        findMany: jest.fn().mockResolvedValue([]),
        create: jest.fn().mockImplementation(({ data }: any) => Promise.resolve(data)),
      },
    };
    const service = new SeoRedirectsService(prisma as never);
    const make = (fromPath: string, toPath: string) =>
      service.create({ fromPath, toPath } as never);

    beforeEach(() => jest.clearAllMocks());

    it('accepts a whole-section move', async () => {
      await expect(make('/old-shop/*', '/shop/*')).resolves.toMatchObject({
        fromPath: '/old-shop/*',
        toPath: '/shop/*',
      });
    });

    it('refuses a wildcard destination without a wildcard source', async () => {
      await expect(make('/one-page', '/new/*')).rejects.toThrow(BadRequestException);
    });

    it('refuses a * anywhere but the end', async () => {
      await expect(make('/shop/*/manga', '/x')).rejects.toThrow(BadRequestException);
    });

    it('refuses a section redirecting to itself', async () => {
      await expect(make('/shop/*', '/shop/*')).rejects.toThrow(ConflictException);
    });

    // The dangerous one: /shop/a -> /shop/manga/a, which the same rule then
    // matches again. A flat chain walk cannot see it — neither path is a key.
    it('refuses a wildcard that sends a section inside itself', async () => {
      await expect(make('/shop/*', '/shop/manga/*')).rejects.toThrow(ConflictException);
    });
  });
});
