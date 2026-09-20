import { MailService } from './mail.service';

/**
 * Where platform alerts actually land.
 *
 * The recipient is typed into a settings box and never checked for
 * deliverability, and yukizi.in — where every other Yukizi address used to
 * sit — has no MX record. An alert sent there fails silently: our SMTP server
 * accepts it, it bounces later, and the first sign of trouble is a support
 * ticket nobody answered for a week. Which is the exact failure the alerting
 * exists to prevent.
 */
describe('MailService.resolveAdminRecipient', () => {
  const ORIGINAL = { ...process.env };

  const build = (settingValue?: string) => {
    const prisma = {
      systemSetting: {
        findUnique: jest
          .fn()
          .mockResolvedValue(settingValue ? { value: settingValue } : null),
      },
    };
    return new MailService(prisma as never);
  };

  beforeEach(() => {
    delete process.env.ADMIN_NOTIFICATION_EMAIL;
    delete process.env.SMTP_USER;
    jest.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    process.env = { ...ORIGINAL };
    jest.restoreAllMocks();
  });

  it('uses the configured address when it can receive mail', async () => {
    const service = build('ops@yukizi.com');
    await expect(service.resolveAdminRecipient()).resolves.toBe('ops@yukizi.com');
  });

  it('redirects a configured address off the domain that bounces', async () => {
    const service = build('support@yukizi.in');
    await expect(service.resolveAdminRecipient()).resolves.toBe(
      'support@yukizi.com',
    );
  });

  it('honours an unrelated address exactly as configured', async () => {
    // Pointing alerts at a personal inbox or a helpdesk must keep working.
    const service = build('rishi@gmail.com');
    await expect(service.resolveAdminRecipient()).resolves.toBe('rishi@gmail.com');
  });

  it('guards the env fallback too, not only the setting', async () => {
    process.env.ADMIN_NOTIFICATION_EMAIL = 'alerts@yukizi.in';
    const service = build(undefined);
    await expect(service.resolveAdminRecipient()).resolves.toBe(
      'alerts@yukizi.com',
    );
  });

  it('falls through setting -> ADMIN_NOTIFICATION_EMAIL -> SMTP_USER', async () => {
    process.env.SMTP_USER = 'platform@yukizi.com';
    const service = build(undefined);
    await expect(service.resolveAdminRecipient()).resolves.toBe(
      'platform@yukizi.com',
    );
  });

  it('returns nothing when nothing is configured anywhere', async () => {
    const service = build(undefined);
    await expect(service.resolveAdminRecipient()).resolves.toBeUndefined();
  });

  it('still answers from env when the settings read throws', async () => {
    process.env.ADMIN_NOTIFICATION_EMAIL = 'ops@yukizi.com';
    const prisma = {
      systemSetting: {
        findUnique: jest.fn().mockRejectedValue(new Error('db down')),
      },
    };
    const service = new MailService(prisma as never);
    await expect(service.resolveAdminRecipient()).resolves.toBe('ops@yukizi.com');
  });
});
