import { Logger } from '@nestjs/common';
import { MailService } from './mail.service';

const sendMailMock = jest.fn<Promise<unknown>, [Record<string, unknown>]>();
const closeMock = jest.fn();
jest.mock('nodemailer', () => ({
  createTransport: jest.fn(() => ({
    sendMail: (message: Record<string, unknown>): Promise<unknown> =>
      sendMailMock(message),
    close: closeMock,
  })),
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
      to: 'buyer@example.com',
      subject: 's',
      text: 't',
      html: '<p>t</p>',
    });

    expect(result).toEqual({ sent: false, retryable: false });
    expect(sendMailMock).not.toHaveBeenCalled();
  });

  it('warns only once across repeated sends on an unconfigured instance', async () => {
    delete process.env.SMTP_USER;
    delete process.env.SMTP_APP_PASSWORD;
    const warnSpy = jest
      .spyOn(Logger.prototype, 'warn')
      .mockImplementation(() => undefined);

    const service = new MailService();
    await service.sendMail({
      to: 'buyer@example.com',
      subject: 's',
      text: 't',
      html: '<p>t</p>',
    });
    await service.sendMail({
      to: 'buyer@example.com',
      subject: 's',
      text: 't',
      html: '<p>t</p>',
    });

    expect(warnSpy).toHaveBeenCalledTimes(1);
    warnSpy.mockRestore();
  });

  it('sends when configured', async () => {
    configure();
    sendMailMock.mockResolvedValue({ messageId: '<1@gmail.com>' });

    const result = await new MailService().sendMail({
      to: 'buyer@example.com',
      subject: 'Your invoice',
      text: 't',
      html: '<p>t</p>',
    });

    expect(result).toEqual({ sent: true, retryable: false });
    expect(sendMailMock).toHaveBeenCalledTimes(1);
  });

  it('sends the expected payload, including attachments', async () => {
    configure();
    sendMailMock.mockResolvedValue({ messageId: '<1@gmail.com>' });
    const attachments = [
      {
        filename: 'invoice.pdf',
        content: Buffer.from('pdf-bytes'),
        contentType: 'application/pdf',
      },
    ];

    await new MailService().sendMail({
      to: 'buyer@example.com',
      subject: 'Your invoice',
      text: 't',
      html: '<p>t</p>',
      attachments,
    });

    expect(sendMailMock).toHaveBeenCalledTimes(1);
    const sentMessage = sendMailMock.mock.calls[0][0];
    expect(sentMessage.from).toBe('"Yukizi" <yukizi@gmail.com>');
    expect(sentMessage.replyTo).toBeUndefined();
    expect(sentMessage.to).toBe('buyer@example.com');
    expect(sentMessage.subject).toBe('Your invoice');
    expect(sentMessage.attachments).toEqual(attachments);
  });

  it('rejects a recipient containing a comma without calling SMTP', async () => {
    configure();

    const result = await new MailService().sendMail({
      to: 'buyer@example.com,attacker@example.com',
      subject: 's',
      text: 't',
      html: '<p>t</p>',
    });

    expect(result).toEqual({ sent: false, retryable: false });
    expect(sendMailMock).not.toHaveBeenCalled();
  });

  it('rejects a recipient containing a newline without calling SMTP', async () => {
    configure();

    const result = await new MailService().sendMail({
      to: 'buyer@example.com\nBcc: attacker@example.com',
      subject: 's',
      text: 't',
      html: '<p>t</p>',
    });

    expect(result).toEqual({ sent: false, retryable: false });
    expect(sendMailMock).not.toHaveBeenCalled();
  });

  it('treats a network error as retryable', async () => {
    configure();
    sendMailMock.mockRejectedValue(
      Object.assign(new Error('socket hang up'), { code: 'ESOCKET' }),
    );

    const result = await new MailService().sendMail({
      to: 'buyer@example.com',
      subject: 's',
      text: 't',
      html: '<p>t</p>',
    });

    expect(result).toEqual({ sent: false, retryable: true });
  });

  it('treats an authentication failure as permanent', async () => {
    configure();
    sendMailMock.mockRejectedValue(
      Object.assign(new Error('Invalid login'), {
        code: 'EAUTH',
        responseCode: 535,
      }),
    );

    const result = await new MailService().sendMail({
      to: 'buyer@example.com',
      subject: 's',
      text: 't',
      html: '<p>t</p>',
    });

    expect(result).toEqual({ sent: false, retryable: false });
  });

  it('treats a 4xx SMTP response as retryable', async () => {
    configure();
    sendMailMock.mockRejectedValue(
      Object.assign(new Error('try again'), { responseCode: 421 }),
    );

    const result = await new MailService().sendMail({
      to: 'buyer@example.com',
      subject: 's',
      text: 't',
      html: '<p>t</p>',
    });

    expect(result).toEqual({ sent: false, retryable: true });
  });

  it('treats a 5xx SMTP response as permanent, not just EAUTH', async () => {
    configure();
    sendMailMock.mockRejectedValue(
      Object.assign(new Error('mailbox unavailable'), { responseCode: 550 }),
    );

    const result = await new MailService().sendMail({
      to: 'buyer@example.com',
      subject: 's',
      text: 't',
      html: '<p>t</p>',
    });

    expect(result).toEqual({ sent: false, retryable: false });
  });

  it('treats EENVELOPE with no responseCode as permanent', async () => {
    configure();
    sendMailMock.mockRejectedValue(
      Object.assign(new Error('No recipients defined'), {
        code: 'EENVELOPE',
      }),
    );

    const result = await new MailService().sendMail({
      to: 'buyer@example.com',
      subject: 's',
      text: 't',
      html: '<p>t</p>',
    });

    expect(result).toEqual({ sent: false, retryable: false });
  });

  it('treats EENVELOPE wrapping a 4xx RCPT TO reply as retryable', async () => {
    configure();
    sendMailMock.mockRejectedValue(
      Object.assign(new Error('Mailbox temporarily unavailable'), {
        code: 'EENVELOPE',
        responseCode: 450,
      }),
    );

    const result = await new MailService().sendMail({
      to: 'buyer@example.com',
      subject: 's',
      text: 't',
      html: '<p>t</p>',
    });

    expect(result).toEqual({ sent: false, retryable: true });
  });

  it('closes the pooled transporter on module destroy', async () => {
    configure();
    sendMailMock.mockResolvedValue({ messageId: '<1@gmail.com>' });
    const service = new MailService();
    await service.sendMail({
      to: 'buyer@example.com',
      subject: 's',
      text: 't',
      html: '<p>t</p>',
    });

    service.onModuleDestroy();

    expect(closeMock).toHaveBeenCalledTimes(1);
  });

  it('does not attempt to close anything if never configured', () => {
    delete process.env.SMTP_USER;
    delete process.env.SMTP_APP_PASSWORD;

    expect(() => new MailService().onModuleDestroy()).not.toThrow();
    expect(closeMock).not.toHaveBeenCalled();
  });
});
