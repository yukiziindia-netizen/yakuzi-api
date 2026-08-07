import {
  ForbiddenException,
  NotFoundException,
  UnprocessableEntityException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { OrdersController } from './orders.controller';
import type { InvoiceEmailOutcome } from './invoice-email.service';

const ORDER_ID = '00323711-1111-2222-3333-444444444444';
const USER_ID = 'buyer-1';

const build = () => {
  const invoiceService = {
    getInvoicesForOrder: jest.fn().mockResolvedValue([{ invoiceNumber: 'x' }]),
  };
  const invoiceEmailService = {
    resendForOrder: jest.fn(),
  };

  const controller = new OrdersController(
    {} as never,
    {} as never,
    invoiceService as never,
    invoiceEmailService as never,
  );

  return { controller, invoiceService, invoiceEmailService };
};

// This is the ONLY place in the codebase that turns an InvoiceEmailOutcome
// into an HTTP status. sendForOrders/resendForOrder never throw, so every
// distinction a caller sees comes from this mapping — get it wrong here and
// a caller-fixable problem (no email on file) and a server problem (SMTP
// down) both read as the same thing again, which is the exact silent-success
// pattern this endpoint exists to avoid.
describe('OrdersController.emailOrderInvoices', () => {
  it('runs the ownership guard before ever calling resendForOrder', async () => {
    const { controller, invoiceService, invoiceEmailService } = build();
    invoiceService.getInvoicesForOrder.mockRejectedValue(
      new ForbiddenException('This order belongs to another account'),
    );

    await expect(
      controller.emailOrderInvoices(USER_ID, ORDER_ID),
    ).rejects.toBeInstanceOf(ForbiddenException);

    expect(invoiceEmailService.resendForOrder).not.toHaveBeenCalled();
  });

  it('returns 200 with sent:true on success', async () => {
    const { controller, invoiceEmailService } = build();
    invoiceEmailService.resendForOrder.mockResolvedValue({
      sent: true,
    } satisfies InvoiceEmailOutcome);

    const result = await controller.emailOrderInvoices(USER_ID, ORDER_ID);

    expect(result).toEqual({
      message: 'Invoice emailed successfully',
      data: { sent: true },
    });
  });

  it('maps no-recipient to 422', async () => {
    const { controller, invoiceEmailService } = build();
    invoiceEmailService.resendForOrder.mockResolvedValue({
      sent: false,
      reason: 'no-recipient',
    } satisfies InvoiceEmailOutcome);

    await expect(
      controller.emailOrderInvoices(USER_ID, ORDER_ID),
    ).rejects.toBeInstanceOf(UnprocessableEntityException);
  });

  it('maps nothing-to-send to 404', async () => {
    const { controller, invoiceEmailService } = build();
    invoiceEmailService.resendForOrder.mockResolvedValue({
      sent: false,
      reason: 'nothing-to-send',
    } satisfies InvoiceEmailOutcome);

    await expect(
      controller.emailOrderInvoices(USER_ID, ORDER_ID),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('maps not-configured to 503, without leaking the reason to the client', async () => {
    const { controller, invoiceEmailService } = build();
    invoiceEmailService.resendForOrder.mockResolvedValue({
      sent: false,
      reason: 'not-configured',
    } satisfies InvoiceEmailOutcome);

    const error: unknown = await controller
      .emailOrderInvoices(USER_ID, ORDER_ID)
      .catch((e: unknown) => e);

    expect(error).toBeInstanceOf(ServiceUnavailableException);
    expect((error as ServiceUnavailableException).message).not.toMatch(
      /not-configured|smtp/i,
    );
  });

  it('maps send-failed to 503, without leaking the reason to the client', async () => {
    const { controller, invoiceEmailService } = build();
    invoiceEmailService.resendForOrder.mockResolvedValue({
      sent: false,
      reason: 'send-failed',
    } satisfies InvoiceEmailOutcome);

    const error: unknown = await controller
      .emailOrderInvoices(USER_ID, ORDER_ID)
      .catch((e: unknown) => e);

    expect(error).toBeInstanceOf(ServiceUnavailableException);
    expect((error as ServiceUnavailableException).message).not.toMatch(
      /send-failed/i,
    );
  });
});
