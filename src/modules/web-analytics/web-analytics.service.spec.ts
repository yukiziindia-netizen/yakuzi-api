import { WebAnalyticsService } from './web-analytics.service';
import { CollectBatchDto } from './web-analytics.dto';

const CHROME = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';

function makePrisma() {
  return {
    webVisitor: { findUnique: jest.fn(), findFirst: jest.fn(), create: jest.fn(), update: jest.fn() },
    webSession: { findUnique: jest.fn(), create: jest.fn(), update: jest.fn(), updateMany: jest.fn() },
    webEvent: { createMany: jest.fn(), create: jest.fn() },
    user: { findUnique: jest.fn() },
  };
}

function batch(overrides: Partial<CollectBatchDto> = {}): CollectBatchDto {
  return {
    visitor: { id: 'v-1', language: 'en-IN', timezone: 'Asia/Calcutta', screenW: 390, screenH: 844 },
    session: { id: 's-1', isNew: true, landingPage: '/', referrer: 'https://chatgpt.com/' },
    events: [{ name: 'page_view', page: '/' }],
    ua: CHROME,
    country: 'IN',
    ...overrides,
  } as CollectBatchDto;
}

describe('WebAnalyticsService.ingest', () => {
  let prisma: ReturnType<typeof makePrisma>;
  let service: WebAnalyticsService;

  beforeEach(() => {
    prisma = makePrisma();
    service = new WebAnalyticsService(prisma as never);
    prisma.webVisitor.findUnique.mockResolvedValue(null);
    prisma.webSession.findUnique.mockResolvedValue(null);
  });

  it('new visitor gets first-touch attribution from the AI referrer', async () => {
    await service.ingest(batch());
    const created = prisma.webVisitor.create.mock.calls[0][0].data;
    expect(created.firstSource).toBe('ChatGPT');
    expect(created.firstSourceCategory).toBe('AI');
    expect(created.firstAttributionLevel).toBe('REFERRER');
    expect(created.firstLandingPage).toBe('/');
    expect(created.country).toBe('IN');
    expect(created.deviceType).toBe('desktop');
  });

  it('returning visitor keeps first-touch: update never writes first* fields', async () => {
    prisma.webVisitor.findUnique.mockResolvedValue({ id: 'v-1' });
    await service.ingest(batch({ session: { id: 's-2', isNew: true, landingPage: '/sale', referrer: 'https://www.google.com/' } as never }));
    for (const call of prisma.webVisitor.update.mock.calls) {
      const data = call[0].data;
      expect(Object.keys(data).some((k) => k.startsWith('first'))).toBe(false);
    }
    // ...but last-touch moves to the new source
    const updateData = prisma.webVisitor.update.mock.calls[0][0].data;
    expect(updateData.lastSource).toBe('Google');
  });

  it('strips PII-shaped and nested props, keeps scalars', async () => {
    await service.ingest(
      batch({
        events: [
          {
            name: 'form_completed',
            props: { email: 'x@y.com', phone: '9999', password: 'p', nested: { a: 1 }, ok: 'fine', count: 2 } as never,
          },
        ],
      }),
    );
    const rows = prisma.webEvent.createMany.mock.calls[0][0].data;
    expect(rows[0].props).toEqual({ ok: 'fine', count: 2 });
  });

  it('sanitizes hostile event names', async () => {
    await service.ingest(batch({ events: [{ name: 'Page View; DROP TABLE users' }] }));
    const rows = prisma.webEvent.createMany.mock.calls[0][0].data;
    expect(rows[0].name).toBe('page_view__drop_table_users');
  });

  it('bot UA marks visitor and session as bot', async () => {
    await service.ingest(batch({ ua: 'Mozilla/5.0 (compatible; GPTBot/1.0)' }));
    expect(prisma.webVisitor.create.mock.calls[0][0].data.isBot).toBe(true);
    expect(prisma.webSession.create.mock.calls[0][0].data.isBot).toBe(true);
  });
});

describe('WebAnalyticsService.identify', () => {
  it('links visitor to user and emits signup_completed when isSignup', async () => {
    const prisma = makePrisma();
    const service = new WebAnalyticsService(prisma as never);
    prisma.webVisitor.update.mockResolvedValue({});
    prisma.webSession.updateMany.mockResolvedValue({ count: 1 });
    prisma.webEvent.create.mockResolvedValue({});

    await service.identify({ visitorId: 'v-1', userId: 'u-1', method: 'google', isSignup: true });

    expect(prisma.webVisitor.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'v-1' }, data: { userId: 'u-1' } }),
    );
    const event = prisma.webEvent.create.mock.calls[0][0].data;
    expect(event.name).toBe('signup_completed');
    expect(event.props).toEqual({ method: 'google' });
  });

  it('never throws when the visitor row does not exist', async () => {
    const prisma = makePrisma();
    const service = new WebAnalyticsService(prisma as never);
    prisma.webVisitor.update.mockRejectedValue(new Error('not found'));
    prisma.webSession.updateMany.mockResolvedValue({ count: 0 });
    prisma.webEvent.create.mockResolvedValue({});
    await expect(
      service.identify({ visitorId: 'ghost', userId: 'u-1', method: 'password', isSignup: false }),
    ).resolves.toBeUndefined();
  });
});
