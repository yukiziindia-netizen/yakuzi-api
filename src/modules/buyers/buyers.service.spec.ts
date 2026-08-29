import { BuyersService } from './buyers.service';

describe('BuyersService — admin email on buyer verification submission', () => {
  const originalAdmin = process.env.ADMIN_NOTIFICATION_EMAIL;
  const originalSmtp = process.env.SMTP_USER;
  afterEach(() => {
    if (originalAdmin === undefined)
      delete process.env.ADMIN_NOTIFICATION_EMAIL;
    else process.env.ADMIN_NOTIFICATION_EMAIL = originalAdmin;
    if (originalSmtp === undefined) delete process.env.SMTP_USER;
    else process.env.SMTP_USER = originalSmtp;
  });

  const build = () => {
    const mailService = {
      sendMail: jest.fn().mockResolvedValue({ sent: true, retryable: false }),
    };
    const service = new BuyersService(
      {} as never,
      {} as never,
      mailService as never,
    );
    return { service, mailService };
  };

  const call = (service: BuyersService, userId: string, name: string | null) =>
    (
      service as unknown as {
        emailAdminNewBuyer(userId: string, name: string | null): Promise<void>;
      }
    ).emailAdminNewBuyer(userId, name);

  it('emails the configured admin address with the buyer name and review link', async () => {
    process.env.ADMIN_NOTIFICATION_EMAIL = 'admin@yukizi.com';
    const { service, mailService } = build();

    await call(service, 'user-1', 'Ravi Kumar');

    expect(mailService.sendMail).toHaveBeenCalledTimes(1);
    const calls = mailService.sendMail.mock.calls as unknown as [
      [{ to: string; subject: string; text: string }],
    ];
    const arg = calls[0][0];
    expect(arg.to).toBe('admin@yukizi.com');
    expect(arg.subject).toContain('Ravi Kumar');
    expect(arg.text).toContain('/users/user-1');
  });

  it('falls back to SMTP_USER when ADMIN_NOTIFICATION_EMAIL is not set', async () => {
    delete process.env.ADMIN_NOTIFICATION_EMAIL;
    process.env.SMTP_USER = 'platform-inbox@yukizi.com';
    const { service, mailService } = build();

    await call(service, 'user-1', null);

    expect(mailService.sendMail).toHaveBeenCalledWith(
      expect.objectContaining({ to: 'platform-inbox@yukizi.com' }),
    );
  });

  it('skips silently (no throw) when neither recipient env var is set', async () => {
    delete process.env.ADMIN_NOTIFICATION_EMAIL;
    delete process.env.SMTP_USER;
    const { service, mailService } = build();

    await expect(call(service, 'user-1', 'Ravi')).resolves.toBeUndefined();
    expect(mailService.sendMail).not.toHaveBeenCalled();
  });

  it('never throws even when the mailer itself rejects', async () => {
    process.env.ADMIN_NOTIFICATION_EMAIL = 'admin@yukizi.com';
    const { service, mailService } = build();
    mailService.sendMail.mockRejectedValueOnce(new Error('smtp down'));

    await expect(call(service, 'user-1', 'Ravi')).resolves.toBeUndefined();
  });
});
