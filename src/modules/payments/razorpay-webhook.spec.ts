import * as crypto from 'crypto';
import {
  BadRequestException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { PaymentVerificationStatus } from '@prisma/client';
import { RazorpayService } from './razorpay.service';

const SECRET = 'whsec_test_1234567890';

const sign = (body: Buffer) =>
  crypto.createHmac('sha256', SECRET).update(body).digest('hex');

const capturedEvent = (over: Record<string, unknown> = {}) =>
  Buffer.from(
    JSON.stringify({
      event: 'payment.captured',
      payload: {
        payment: {
          entity: {
            id: 'pay_TEST123',
            order_id: 'order_TEST123',
            amount: 18558,
            ...over,
          },
        },
      },
    }),
  );

describe('RazorpayService.handleWebhook', () => {
  const configService = {
    get: jest.fn((key: string) =>
      key === 'RAZORPAY_WEBHOOK_SECRET' ? SECRET : undefined,
    ),
  };
  const prisma = {
    payment: {
      findFirst: jest.fn(),
      update: jest.fn(),
    },
  };
  const paymentsService = { confirmPayment: jest.fn() };

  const service = new RazorpayService(
    configService as never,
    prisma as never,
    paymentsService as never,
  );

  const pendingPayment = {
    id: 'payment-uuid',
    orderId: 'our-order-uuid',
    amount: 185.58,
    referenceNumber: 'order_TEST123',
    verificationStatus: PaymentVerificationStatus.PENDING,
  };

  beforeEach(() => {
    jest.clearAllMocks();
    configService.get.mockImplementation((key: string) =>
      key === 'RAZORPAY_WEBHOOK_SECRET' ? SECRET : undefined,
    );
  });

  it('503s when the webhook secret is not configured, so Razorpay retries later', async () => {
    configService.get.mockReturnValue(undefined);
    await expect(
      service.handleWebhook(capturedEvent(), 'anything'),
    ).rejects.toBeInstanceOf(ServiceUnavailableException);
  });

  it('rejects a body whose signature does not verify', async () => {
    const body = capturedEvent();
    await expect(
      service.handleWebhook(body, sign(Buffer.from('other bytes'))),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.payment.findFirst).not.toHaveBeenCalled();
  });

  it('rejects a missing raw body instead of verifying a re-serialisation', async () => {
    await expect(
      service.handleWebhook(undefined, 'sig'),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('confirms the pending payment on a signed payment.captured', async () => {
    const body = capturedEvent();
    prisma.payment.findFirst.mockResolvedValue({ ...pendingPayment });
    paymentsService.confirmPayment.mockResolvedValue({ confirmed: true });

    const result = await service.handleWebhook(body, sign(body));

    expect(result).toEqual({ ok: true, handled: true });
    expect(prisma.payment.findFirst).toHaveBeenCalledWith({
      where: { referenceNumber: { startsWith: 'order_TEST123' } },
    });
    expect(prisma.payment.update).toHaveBeenCalledWith({
      where: { id: 'payment-uuid' },
      data: { referenceNumber: 'order_TEST123|pay_TEST123' },
    });
    expect(paymentsService.confirmPayment).toHaveBeenCalledWith('payment-uuid');
  });

  it('acknowledges without acting on events other than payment.captured', async () => {
    const body = Buffer.from(JSON.stringify({ event: 'payment.failed' }));
    const result = await service.handleWebhook(body, sign(body));
    expect(result).toEqual({ ok: true, handled: false });
    expect(prisma.payment.findFirst).not.toHaveBeenCalled();
  });

  it('acknowledges an unknown razorpay order id instead of making Razorpay retry forever', async () => {
    const body = capturedEvent();
    prisma.payment.findFirst.mockResolvedValue(null);
    const result = await service.handleWebhook(body, sign(body));
    expect(result).toEqual({ ok: true, handled: false });
    expect(paymentsService.confirmPayment).not.toHaveBeenCalled();
  });

  it('is idempotent for an already-confirmed payment', async () => {
    const body = capturedEvent();
    prisma.payment.findFirst.mockResolvedValue({
      ...pendingPayment,
      verificationStatus: PaymentVerificationStatus.CONFIRMED,
    });
    const result = await service.handleWebhook(body, sign(body));
    expect(result).toEqual({ ok: true, handled: true, alreadyConfirmed: true });
    expect(paymentsService.confirmPayment).not.toHaveBeenCalled();
  });

  it('never confirms when the captured amount does not match our order', async () => {
    const body = capturedEvent({ amount: 100 });
    prisma.payment.findFirst.mockResolvedValue({ ...pendingPayment });
    const result = await service.handleWebhook(body, sign(body));
    expect(result).toEqual({ ok: true, handled: false });
    expect(prisma.payment.update).not.toHaveBeenCalled();
    expect(paymentsService.confirmPayment).not.toHaveBeenCalled();
  });

  it('treats losing the race against /verify as success, not failure', async () => {
    const body = capturedEvent();
    prisma.payment.findFirst.mockResolvedValue({ ...pendingPayment });
    paymentsService.confirmPayment.mockRejectedValue(
      new BadRequestException('Payment is already confirmed'),
    );
    const result = await service.handleWebhook(body, sign(body));
    expect(result).toEqual({ ok: true, handled: true, alreadyConfirmed: true });
  });
});
