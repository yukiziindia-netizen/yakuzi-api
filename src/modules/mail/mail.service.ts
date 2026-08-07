import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
// tsconfig sets esModuleInterop + allowSyntheticDefaultImports, so a default
// import is the correct form here. The named type import is separate because a
// default import cannot also be used as a type namespace.
import nodemailer, { type Transporter } from 'nodemailer';
import { redactEmail } from './redact-email';

export interface MailAttachment {
  filename: string;
  content: Buffer;
  contentType?: string;
}

export interface SendMailOptions {
  to: string;
  subject: string;
  text: string;
  html: string;
  attachments?: MailAttachment[];
}

export interface MailResult {
  sent: boolean;
  /** Whether another attempt could plausibly succeed. */
  retryable: boolean;
}

interface MailSession {
  transporter: Transporter;
  /** Snapshot of the address the transporter authenticated with — see getSession(). */
  fromUser: string;
}

/**
 * nodemailer's own permanent, API-level rejections (invalid recipient, no
 * recipients defined, empty message). These carry NO SMTP responseCode, so
 * without this list they'd fall into the network-level default of
 * retryable=true below and burn the retry budget + Gmail daily quota on a
 * message that can never send. When a responseCode IS present, EENVELOPE is
 * instead wrapping a genuine RCPT TO reply — the responseCode range check
 * stays authoritative in that case, see isRetryable().
 */
const PERMANENT_CODES_WITHOUT_RESPONSE = new Set(['EENVELOPE', 'EMESSAGE']);

/**
 * The only place in the API that knows SMTP exists.
 *
 * Ships inert: with no SMTP_USER / SMTP_APP_PASSWORD it logs once and reports
 * failure, exactly as Razorpay and Google sign-in shipped inert. Merging this
 * changes nothing until the box is configured.
 *
 * There are deliberately NO hardcoded credential defaults here. otp-sms.service.ts
 * baked live Nimbus credentials into a public repo and they now need rotating.
 */
@Injectable()
export class MailService implements OnModuleDestroy {
  private readonly logger = new Logger(MailService.name);
  private session: MailSession | null = null;
  private warnedUnconfigured = false;

  private get user(): string | undefined {
    return process.env.SMTP_USER?.trim() || undefined;
  }

  private get pass(): string | undefined {
    return process.env.SMTP_APP_PASSWORD?.trim() || undefined;
  }

  isConfigured(): boolean {
    return Boolean(this.user && this.pass);
  }

  private getSession(): MailSession | null {
    if (!this.isConfigured()) return null;
    if (!this.session) {
      // Snapshot user/pass here: the transporter is a long-lived pooled
      // connection built once, but `from` is read on every send. If we read
      // process.env fresh on every send instead, a credential rotation
      // without a restart authenticates as one address and claims a
      // different one in the `from` header, which Gmail rejects.
      const user = this.user as string;
      const pass = this.pass as string;
      this.session = {
        fromUser: user,
        transporter: nodemailer.createTransport({
          service: 'gmail',
          auth: { user, pass },
          pool: true,
          maxConnections: 1,
          // Defaults are minutes long (connection 2m, socket 10m). With
          // maxConnections:1, one black-holed connection would queue every
          // subsequent message behind it — mail must never slow a payment
          // confirmation, so these are cut hard.
          connectionTimeout: 10000,
          greetingTimeout: 10000,
          socketTimeout: 20000,
        }),
      };
    }
    return this.session;
  }

  /** pm2 restarts the process on every deploy; close the pool so it doesn't hang around. */
  onModuleDestroy(): void {
    this.session?.transporter.close();
  }

  /**
   * Hands a message to the SMTP server. NEVER throws — callers get a result.
   */
  async sendMail(options: SendMailOptions): Promise<MailResult> {
    const session = this.getSession();

    if (!session) {
      if (!this.warnedUnconfigured) {
        this.logger.warn(
          'SMTP is not configured (SMTP_USER / SMTP_APP_PASSWORD unset) — outbound mail is disabled.',
        );
        this.warnedUnconfigured = true;
      }
      return { sent: false, retryable: false };
    }

    // Nodemailer fans a comma-separated `to` out to every address inside it.
    // The invoice PDF carries the buyer's name, address and order contents,
    // so a malformed stored address here is a PII leak, not just a bounce.
    // DTO validation upstream is the primary defence; this is the last line
    // before the wire.
    if (/[,\r\n]/.test(options.to)) {
      this.logger.error(
        `Refusing to send to malformed recipient: ${redactEmail(options.to)}`,
      );
      return { sent: false, retryable: false };
    }

    try {
      await session.transporter.sendMail({
        from: `"${process.env.MAIL_FROM_NAME?.trim() || 'Yukizi'}" <${session.fromUser}>`,
        replyTo: process.env.MAIL_REPLY_TO?.trim() || undefined,
        to: options.to,
        subject: options.subject,
        text: options.text,
        html: options.html,
        attachments: options.attachments,
      });
      return { sent: true, retryable: false };
    } catch (error) {
      const retryable = this.isRetryable(error);
      this.logger.error(
        `Mail to ${redactEmail(options.to)} failed (retryable=${retryable}): ${(error as Error).message}`,
      );
      return { sent: false, retryable };
    }
  }

  /**
   * 4xx SMTP replies are temporary and worth another attempt. 5xx replies and
   * authentication failures are permanent — retrying them only burns the daily
   * quota. EENVELOPE/EMESSAGE with no responseCode are nodemailer's own
   * permanent, API-level rejections (see PERMANENT_CODES_WITHOUT_RESPONSE);
   * with a responseCode present, that check stays authoritative instead,
   * because EENVELOPE can also wrap a genuine (retryable) 4xx RCPT TO reply.
   * An error with no SMTP code or responseCode at all is network-level, so
   * retry.
   */
  private isRetryable(error: unknown): boolean {
    const err = error as { responseCode?: number; code?: string };
    if (err?.code === 'EAUTH') return false;

    if (typeof err?.responseCode === 'number') {
      return err.responseCode >= 400 && err.responseCode < 500;
    }

    if (err?.code && PERMANENT_CODES_WITHOUT_RESPONSE.has(err.code)) {
      return false;
    }

    return true;
  }
}
