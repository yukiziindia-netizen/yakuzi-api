import { MailService } from './mail.service';

const sendMailMock = jest.fn();
jest.mock('nodemailer', () => ({
  createTransport: jest.fn(() => ({ sendMail: (...a: unknown[]) => sendMailMock(...a) })),
}));

describe('MailService', () => {
  const OLD_ENV = process.env;

  beforeEach(() => {
    jest.clearAllMocks();
    process.env = { ...OLD_ENV };
  });

  afterAll(() => {
    process.env = OLD_ENV;
  });

  const configure = () => {
    process.env.SMTP_USER = 'yukizi@gmail.com';
    process.env.SMTP_APP_PASSWORD = 'abcd efgh ijkl mnop';
  };

  it('is inert and never throws when SMTP is not configured', async () => {
    delete process.env.SMTP_USER;
    delete process.env.SMTP_APP_PASSWORD;

    const result = await new MailService().sendMail({
      to: 'buyer@example.com', subject: 's', text: 't', html: '<p>t</p>',
    });

    expect(result).toEqual({ sent: false, retryable: false });
    expect(sendMailMock).not.toHaveBeenCalled();
  });

  it('sends when configured', async () => {
    configure();
    sendMailMock.mockResolvedValue({ messageId: '<1@gmail.com>' });

    const result = await new MailService().sendMail({
      to: 'buyer@example.com', subject: 'Your invoice', text: 't', html: '<p>t</p>',
    });

    expect(result).toEqual({ sent: true, retryable: false });
    expect(sendMailMock).toHaveBeenCalledTimes(1);
  });

  it('treats a network error as retryable', async () => {
    configure();
    sendMailMock.mockRejectedValue(Object.assign(new Error('socket hang up'), { code: 'ESOCKET' }));

    const result = await new MailService().sendMail({
      to: 'buyer@example.com', subject: 's', text: 't', html: '<p>t</p>',
    });

    expect(result).toEqual({ sent: false, retryable: true });
  });

  it('treats an authentication failure as permanent', async () => {
    configure();
    sendMailMock.mockRejectedValue(Object.assign(new Error('Invalid login'), { code: 'EAUTH', responseCode: 535 }));

    const result = await new MailService().sendMail({
      to: 'buyer@example.com', subject: 's', text: 't', html: '<p>t</p>',
    });

    expect(result).toEqual({ sent: false, retryable: false });
  });

  it('treats a 4xx SMTP response as retryable', async () => {
    configure();
    sendMailMock.mockRejectedValue(Object.assign(new Error('try again'), { responseCode: 421 }));

    const result = await new MailService().sendMail({
      to: 'buyer@example.com', subject: 's', text: 't', html: '<p>t</p>',
    });

    expect(result).toEqual({ sent: false, retryable: true });
  });
});
