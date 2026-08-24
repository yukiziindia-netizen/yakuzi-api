import { ConflictException } from '@nestjs/common';
import { SellersService } from './sellers.service';
import type { CreateSellerProfileDto } from './dto/create-seller-profile.dto';

const dto = (over: Partial<CreateSellerProfileDto> = {}): CreateSellerProfileDto =>
  ({
    companyName: 'Acme Pharma',
    address: '1 Main St',
    city: 'Kolkata',
    state: 'West Bengal',
    pincode: '700001',
    ...over,
  }) as CreateSellerProfileDto;

const build = (existing: unknown = null) => {
  const createdProfile = { id: 'profile-1', companyName: 'Acme Pharma', email: 'acme@example.com', verificationStatus: 'UNVERIFIED' };
  const prisma = {
    sellerProfile: {
      findUnique: jest.fn().mockResolvedValue(existing),
      create: jest.fn().mockResolvedValue(createdProfile),
    },
  };
  const idfyService = { isConfigured: jest.fn().mockReturnValue(false), verifyGst: jest.fn() };
  const mailService = { sendMail: jest.fn().mockResolvedValue({ sent: true, retryable: false }) };
  const service = new SellersService(prisma as never, idfyService as never, mailService as never);
  return { service, prisma, mailService, createdProfile };
};

describe('SellersService.createProfile — admin notification email', () => {
  const originalEnv = process.env.ADMIN_NOTIFICATION_EMAIL;
  const originalSmtpUser = process.env.SMTP_USER;
  afterEach(() => {
    if (originalEnv === undefined) delete process.env.ADMIN_NOTIFICATION_EMAIL;
    else process.env.ADMIN_NOTIFICATION_EMAIL = originalEnv;
    if (originalSmtpUser === undefined) delete process.env.SMTP_USER;
    else process.env.SMTP_USER = originalSmtpUser;
  });

  it('emails the configured admin address with the seller company name', async () => {
    process.env.ADMIN_NOTIFICATION_EMAIL = 'admin@yukizi.com';
    const { service, mailService } = build();

    await service.createProfile('user-1', dto());

    expect(mailService.sendMail).toHaveBeenCalledWith(
      expect.objectContaining({
        to: 'admin@yukizi.com',
        subject: expect.stringContaining('Acme Pharma'),
      }),
    );
  });

  it('falls back to SMTP_USER when ADMIN_NOTIFICATION_EMAIL is not set', async () => {
    delete process.env.ADMIN_NOTIFICATION_EMAIL;
    process.env.SMTP_USER = 'platform-inbox@yukizi.com';
    const { service, mailService } = build();

    await service.createProfile('user-1', dto());

    expect(mailService.sendMail).toHaveBeenCalledWith(
      expect.objectContaining({ to: 'platform-inbox@yukizi.com' }),
    );
  });

  it('does not email, and does not throw, when no admin address is configured at all', async () => {
    delete process.env.ADMIN_NOTIFICATION_EMAIL;
    delete process.env.SMTP_USER;
    const { service, mailService } = build();

    await expect(service.createProfile('user-1', dto())).resolves.toBeDefined();
    expect(mailService.sendMail).not.toHaveBeenCalled();
  });

  it('profile creation succeeds even when the mailer reports failure', async () => {
    process.env.ADMIN_NOTIFICATION_EMAIL = 'admin@yukizi.com';
    const { service, mailService } = build();
    mailService.sendMail.mockResolvedValue({ sent: false, retryable: true });

    await expect(service.createProfile('user-1', dto())).resolves.toBeDefined();
  });

  it('still throws ConflictException for a duplicate profile, without emailing', async () => {
    process.env.ADMIN_NOTIFICATION_EMAIL = 'admin@yukizi.com';
    const { service, mailService } = build({ id: 'existing' });

    await expect(service.createProfile('user-1', dto())).rejects.toBeInstanceOf(
      ConflictException,
    );
    expect(mailService.sendMail).not.toHaveBeenCalled();
  });

  it('HTML-escapes the company name in the email body but not the plain-text body', async () => {
    process.env.ADMIN_NOTIFICATION_EMAIL = 'admin@yukizi.com';
    const { service, mailService, prisma, createdProfile } = build();
    const dangerousDto = dto({ companyName: 'Acme <script>alert(1)</script> & "Co"' });
    prisma.sellerProfile.create.mockResolvedValueOnce({
      ...createdProfile,
      companyName: dangerousDto.companyName,
    });

    await service.createProfile('user-1', dangerousDto);

    const call = mailService.sendMail.mock.calls[0][0];
    expect(call.html).toContain('Acme &lt;script&gt;alert(1)&lt;/script&gt; &amp; &quot;Co&quot;');
    expect(call.html).not.toContain('<script>alert(1)</script>');
    expect(call.text).toContain('Acme <script>alert(1)</script> & "Co"');
  });
});

describe('SellersService.getWaitlist', () => {
  const build = () => {
    const prisma = {
      sellerProfile: { findUnique: jest.fn() },
      sellerOffer: { findMany: jest.fn() },
      productWaitlist: { findMany: jest.fn() },
    };
    const idfyService = { isConfigured: jest.fn().mockReturnValue(false), verifyGst: jest.fn() };
    const mailService = { sendMail: jest.fn().mockResolvedValue({ sent: true, retryable: false }) };
    const service = new SellersService(prisma as never, idfyService as never, mailService as never);
    return { service, prisma };
  };

  it('returns an empty array when the user has no seller profile', async () => {
    const { service, prisma } = build();
    prisma.sellerProfile.findUnique.mockResolvedValue(null);

    const result = await service.getWaitlist('user-1');

    expect(result).toEqual([]);
    expect(prisma.sellerOffer.findMany).not.toHaveBeenCalled();
  });

  it('scopes to catalog products the seller currently has an active offer for', async () => {
    const { service, prisma } = build();
    prisma.sellerProfile.findUnique.mockResolvedValue({ id: 'profile-1' });
    prisma.sellerOffer.findMany.mockResolvedValue([
      { catalogProductId: 'prod-1' },
      { catalogProductId: 'prod-2' },
    ]);
    prisma.productWaitlist.findMany.mockResolvedValue([]);

    await service.getWaitlist('user-1');

    expect(prisma.sellerOffer.findMany).toHaveBeenCalledWith({
      where: {
        sellerId: 'profile-1',
        isActive: true,
        deletedAt: null,
        approvalStatus: 'APPROVED',
        catalogProductId: { not: null },
      },
      select: { catalogProductId: true },
      distinct: ['catalogProductId'],
    });
    expect(prisma.productWaitlist.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { catalogProductId: { in: ['prod-1', 'prod-2'] } },
      }),
    );
  });

  it('filters to a single productId when provided, excluding products the seller does not carry', async () => {
    const { service, prisma } = build();
    prisma.sellerProfile.findUnique.mockResolvedValue({ id: 'profile-1' });
    prisma.sellerOffer.findMany.mockResolvedValue([{ catalogProductId: 'prod-1' }]);
    prisma.productWaitlist.findMany.mockResolvedValue([]);

    const result = await service.getWaitlist('user-1', 'prod-not-mine');

    expect(result).toEqual([]);
    expect(prisma.productWaitlist.findMany).not.toHaveBeenCalled();
  });

  it('maps waitlist rows to the response shape, falling back through image and buyer name sources', async () => {
    const { service, prisma } = build();
    prisma.sellerProfile.findUnique.mockResolvedValue({ id: 'profile-1' });
    prisma.sellerOffer.findMany.mockResolvedValue([{ catalogProductId: 'prod-1' }]);
    prisma.productWaitlist.findMany.mockResolvedValue([
      {
        id: 'wl-1',
        createdAt: new Date('2026-08-20T10:00:00.000Z'),
        isNotified: false,
        catalogProduct: { id: 'prod-1', name: 'Funko Pop', images: [{ url: 'https://img/1.png' }] },
        user: { username: 'anime_fan_92' },
      },
      {
        id: 'wl-2',
        createdAt: new Date('2026-08-20T09:00:00.000Z'),
        isNotified: true,
        catalogProduct: { id: 'prod-1', name: 'Funko Pop', images: [] },
        user: { username: null },
      },
    ]);

    const result = await service.getWaitlist('user-1');

    expect(result).toEqual([
      {
        id: 'wl-1',
        product: { id: 'prod-1', name: 'Funko Pop', image: 'https://img/1.png' },
        buyer: { name: 'anime_fan_92' },
        createdAt: new Date('2026-08-20T10:00:00.000Z'),
        isNotified: false,
      },
      {
        id: 'wl-2',
        product: { id: 'prod-1', name: 'Funko Pop', image: null },
        buyer: { name: 'Yukizi buyer' },
        createdAt: new Date('2026-08-20T09:00:00.000Z'),
        isNotified: true,
      },
    ]);
  });
});
