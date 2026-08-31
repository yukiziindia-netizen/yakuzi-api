import { SeoNotFoundService } from './seo-not-found.service';

describe('SeoNotFoundService', () => {
  const prisma = {
    seoNotFound: {
      upsert: jest.fn(),
      findUnique: jest.fn(),
      findMany: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
      deleteMany: jest.fn(),
      updateMany: jest.fn(),
      count: jest.fn(),
      aggregate: jest.fn(),
    },
    $transaction: jest.fn(),
  };
  const service = new SeoNotFoundService(prisma as never);

  beforeEach(() => {
    jest.clearAllMocks();
    prisma.$transaction.mockImplementation((ops: Promise<unknown>[]) => Promise.all(ops));
    prisma.seoNotFound.findUnique.mockResolvedValue(null);
    prisma.seoNotFound.upsert.mockResolvedValue({});
    prisma.seoNotFound.updateMany.mockResolvedValue({ count: 0 });
  });

  describe('record', () => {
    it('normalizes the path so /Old/ and /old are one row, not three', async () => {
      await service.record({ path: '/Old-Page/' });
      expect(prisma.seoNotFound.upsert).toHaveBeenCalledWith(
        expect.objectContaining({ where: { path: '/old-page' } }),
      );
    });

    it('counts a repeat hit instead of adding another row', async () => {
      await service.record({ path: '/gone' });
      const call = prisma.seoNotFound.upsert.mock.calls[0][0];
      expect(call.update.hits).toEqual({ increment: 1 });
    });

    it('truncates a hostile referrer and user agent', async () => {
      await service.record({
        path: '/gone',
        referrer: 'r'.repeat(900),
        userAgent: 'u'.repeat(900),
      });
      const call = prisma.seoNotFound.upsert.mock.calls[0][0];
      expect(call.create.lastReferrer).toHaveLength(500);
      expect(call.create.lastUserAgent).toHaveLength(300);
    });

    it('reopens a FIXED path that has started 404ing again', async () => {
      prisma.seoNotFound.findUnique.mockResolvedValue({ status: 'FIXED' });
      await service.record({ path: '/gone' });
      const call = prisma.seoNotFound.upsert.mock.calls[0][0];
      expect(call.update.status).toBe('NEW');
    });

    it('leaves an IGNORED path ignored — that was a deliberate decision', async () => {
      prisma.seoNotFound.findUnique.mockResolvedValue({ status: 'IGNORED' });
      await service.record({ path: '/wp-login.php' });
      const call = prisma.seoNotFound.upsert.mock.calls[0][0];
      expect(call.update.status).toBeUndefined();
    });

    it('never throws — it is called from a page that is already failing', async () => {
      prisma.seoNotFound.upsert.mockRejectedValue(new Error('db down'));
      await expect(service.record({ path: '/gone' })).resolves.toBeUndefined();
    });

    it('ignores an unusable path without touching the database', async () => {
      await service.record({ path: '   ' });
      expect(prisma.seoNotFound.upsert).not.toHaveBeenCalled();
    });
  });

  describe('list', () => {
    beforeEach(() => {
      prisma.seoNotFound.count.mockResolvedValue(0);
      prisma.seoNotFound.findMany.mockResolvedValue([]);
    });

    it('defaults to most-hit first — the biggest loss is the first job', async () => {
      await service.list({});
      expect(prisma.seoNotFound.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ orderBy: { hits: 'desc' } }),
      );
    });

    it('supports newest-first', async () => {
      await service.list({ sort: 'recent' });
      expect(prisma.seoNotFound.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ orderBy: { lastSeenAt: 'desc' } }),
      );
    });

    it('caps the page size so one request cannot pull the whole table', async () => {
      await service.list({ limit: 9999 });
      expect(prisma.seoNotFound.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ take: 200 }),
      );
    });
  });

  describe('markFixed', () => {
    it('marks the given paths fixed but never overrides an IGNORED decision', async () => {
      await service.markFixed(['/a', '/b']);
      expect(prisma.seoNotFound.updateMany).toHaveBeenCalledWith({
        where: { path: { in: ['/a', '/b'] }, status: { not: 'IGNORED' } },
        data: { status: 'FIXED' },
      });
    });

    it('does nothing for an empty list', async () => {
      await service.markFixed([]);
      expect(prisma.seoNotFound.updateMany).not.toHaveBeenCalled();
    });

    it('never fails redirect creation over bookkeeping', async () => {
      prisma.seoNotFound.updateMany.mockRejectedValue(new Error('db down'));
      await expect(service.markFixed(['/a'])).resolves.toBeUndefined();
    });
  });

  describe('clearResolved', () => {
    it('removes only what has already been dealt with', async () => {
      prisma.seoNotFound.deleteMany.mockResolvedValue({ count: 4 });
      await expect(service.clearResolved()).resolves.toEqual({ deleted: 4 });
      expect(prisma.seoNotFound.deleteMany).toHaveBeenCalledWith({
        where: { status: { in: ['FIXED', 'IGNORED'] } },
      });
    });
  });
});
