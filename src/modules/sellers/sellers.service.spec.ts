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
  afterEach(() => {
    process.env.ADMIN_NOTIFICATION_EMAIL = originalEnv;
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

  it('does not email, and does not throw, when no admin address is configured', async () => {
    delete process.env.ADMIN_NOTIFICATION_EMAIL;
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
