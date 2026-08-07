import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';
import { InvoiceService, type Invoice } from './invoice.service';
import { InvoicePdfService } from './invoice-pdf.service';
import { MailService, type MailAttachment } from '../mail/mail.service';
import { redactEmail } from '../mail/redact-email';

/**
 * Emails a buyer the tax invoices for orders that have just been paid.
 *
 * Idempotency without a migration: the deploy never runs `prisma migrate deploy`,
 * so there is no table to record sends in. The existing Notification row is the
 * ledger instead — it keys on the order's 8-character reference, it is queryable
 * when someone asks whether an invoice went out, and it doubles as the
 * buyer-visible confirmation in the notification bell.
 *
 * The lookup cannot be scoped by user: it runs before the orders (and therefore
 * the buyer) are loaded. An 8-hex-character reference is unique enough across
 * the order table for that to be safe.
 */

const LEDGER_MARKER = 'tax invoice for order';

@Injectable()
export class InvoiceEmailService {
  private readonly logger = new Logger(InvoiceEmailService.name);

  /** Attempt delays. Overridden in tests to keep them fast. */
  private backoffMs = [2000, 10000, 30000];

  constructor(
    private readonly prisma: PrismaService,
    private readonly invoiceService: InvoiceService,
    private readonly invoicePdfService: InvoicePdfService,
    private readonly mailService: MailService,
  ) {}

  /**
   * Fire-and-forget entry point for the payment path.
   *
   * Deliberately returns void and swallows everything: confirming a payment must
   * never be slowed down, failed or rolled back because an email did not send.
   */
  dispatchForOrders(orderIds: string[]): void {
    void this.sendForOrders(orderIds).catch((error) => {
      this.logger.error(
        `Invoice email dispatch failed: ${(error as Error).message}`,
      );
    });
  }

  /**
   * Sends one email carrying every invoice for the given orders.
   *
   * Orders are split per seller at checkout, so a single cart produces several
   * order rows. They belong to one buyer and one payment, so they belong in one
   * email — three separate emails for one checkout reads as spam.
   */
  async sendForOrders(
    orderIds: string[],
    opts: { force?: boolean } = {},
  ): Promise<boolean> {
    try {
      const ids = Array.from(new Set(orderIds.filter(Boolean)));
      if (ids.length === 0) return false;

      const pending = opts.force
        ? ids
        : (
            await Promise.all(
              ids.map(async (id) => ((await this.alreadySent(id)) ? null : id)),
            )
          ).filter((id): id is string => id !== null);

      if (pending.length === 0) return false;

      const orders = await this.prisma.order.findMany({
        where: { id: { in: pending } },
        select: {
          id: true,
          buyerId: true,
          buyer: { select: { id: true, email: true } },
        },
      });
      if (orders.length === 0) return false;

      const recipient = orders[0].buyer?.email?.trim();
      if (!recipient) {
        // Buyers can register with phone OTP alone, so User.email may be null and
        // there is genuinely nowhere to send. Not an error — but countable, so we
        // can measure how often it happens.
        this.logger.warn(
          `invoice-email skipped: buyer ${orders[0].buyerId} has no email address (orders=${pending.length})`,
        );
        return false;
      }

      const invoices: Invoice[] = [];
      for (const order of orders) {
        invoices.push(
          ...(await this.invoiceService.buildInvoicesForOrder(order.id)),
        );
      }
      if (invoices.length === 0) return false;

      const attachments: MailAttachment[] = [];
      for (const invoice of invoices) {
        attachments.push({
          filename: this.invoicePdfService.filename(invoice),
          content: await this.invoicePdfService.render(invoice),
          contentType: 'application/pdf',
        });
      }

      const sent = await this.sendWithRetry(recipient, invoices, attachments);
      if (!sent) return false;

      for (const order of orders) {
        await this.writeLedger(order.buyerId, order.id);
      }

      this.logger.log(
        `invoice-email sent to ${redactEmail(recipient)} (orders=${orders.length}, invoices=${invoices.length})`,
      );
      return true;
    } catch (error) {
      // Nothing here may surface to the payment path.
      this.logger.error(`invoice-email failed: ${(error as Error).message}`);
      return false;
    }
  }

  /**
   * Buyer-initiated resend. The caller is responsible for having already proved
   * the buyer owns the order — orders.controller does that through
   * InvoiceService.getInvoicesForOrder, which throws for anyone else.
   */
  async resendForOrder(orderId: string): Promise<boolean> {
    return this.sendForOrders([orderId], { force: true });
  }

  private async alreadySent(orderId: string): Promise<boolean> {
    const found = await this.prisma.notification.findFirst({
      where: { message: { contains: this.ledgerText(orderId) } },
      select: { id: true },
    });
    return Boolean(found);
  }

  private async writeLedger(userId: string, orderId: string): Promise<void> {
    await this.prisma.notification.create({
      data: {
        userId,
        message: `Your ${this.ledgerText(orderId)} has been emailed to you.`,
      },
    });
  }

  /**
   * The ledger key, and also what the buyer reads in their notification bell.
   * The 8-character order prefix is the same reference the invoice number uses.
   */
  private ledgerText(orderId: string): string {
    return `${LEDGER_MARKER} ${orderId.slice(0, 8).toUpperCase()}`;
  }

  private async sendWithRetry(
    to: string,
    invoices: Invoice[],
    attachments: MailAttachment[],
  ): Promise<boolean> {
    const subject =
      invoices.length === 1
        ? `Your Yukizi tax invoice ${invoices[0].invoiceNumber}`
        : `Your Yukizi tax invoices (${invoices.length})`;

    const message = {
      to,
      subject,
      text: this.plainBody(invoices),
      html: this.htmlBody(invoices),
      attachments,
    };

    for (let attempt = 0; attempt < this.backoffMs.length; attempt++) {
      const result = await this.mailService.sendMail(message);
      if (result.sent) return true;
      if (!result.retryable) return false;

      const wait = this.backoffMs[attempt];
      if (attempt < this.backoffMs.length - 1 && wait > 0) {
        await new Promise((resolve) => setTimeout(resolve, wait));
      }
    }

    return false;
  }

  private plainBody(invoices: Invoice[]): string {
    const total = invoices
      .reduce((sum, i) => sum + i.totalAmount, 0)
      .toFixed(2);
    const list = invoices
      .map((i) => `  ${i.invoiceNumber}  Rs. ${i.totalAmount.toFixed(2)}`)
      .join('\n');
    return [
      `Hello ${invoices[0].buyer.name || 'there'},`,
      '',
      'Thank you for your order. Your tax invoice is attached to this email.',
      '',
      list,
      '',
      `Total: Rs. ${total}`,
      '',
      'Each invoice is issued by the seller who supplied the goods, and generated',
      'by Yukizi on their behalf.',
      '',
      'Need help? Email support@yukizi.com',
      '',
      'Yukizi',
    ].join('\n');
  }

  private htmlBody(invoices: Invoice[]): string {
    const rows = invoices
      .map(
        (i) =>
          `<tr><td style="padding:6px 12px 6px 0;color:#475569">${i.invoiceNumber}</td>` +
          `<td style="padding:6px 0;text-align:right;font-weight:600;color:#0f172a">Rs. ${i.totalAmount.toFixed(2)}</td></tr>`,
      )
      .join('');

    return `<div style="font-family:Arial,Helvetica,sans-serif;font-size:14px;color:#0f172a;max-width:520px">
  <p style="font-size:18px;font-weight:700;color:#593696;margin:0 0 16px">Yukizi</p>
  <p>Hello ${this.escape(invoices[0].buyer.name) || 'there'},</p>
  <p>Thank you for your order. Your tax ${invoices.length === 1 ? 'invoice is' : 'invoices are'} attached to this email.</p>
  <table style="border-collapse:collapse;margin:16px 0">${rows}</table>
  <p style="color:#475569;font-size:12px">Each invoice is issued by the seller who supplied the goods, and generated by Yukizi on their behalf.</p>
  <p style="color:#475569;font-size:12px">Need help? Email <a href="mailto:support@yukizi.com">support@yukizi.com</a></p>
</div>`;
  }

  private escape(value: string): string {
    return String(value ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }
}
