import { Injectable, Logger } from '@nestjs/common';
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
export class MailService {
  private readonly logger = new Logger(MailService.name);
  private transporter: Transporter | null = null;
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

  private getTransporter(): Transporter | null {
    if (!this.isConfigured()) return null;
    if (!this.transporter) {
      this.transporter = nodemailer.createTransport({
        service: 'gmail',
        auth: { user: this.user, pass: this.pass },
        pool: true,
        maxConnections: 1,
      });
    }
    return this.transporter;
  }

  /**
   * Hands a message to the SMTP server. NEVER throws — callers get a result.
   */
  async sendMail(options: SendMailOptions): Promise<MailResult> {
    const transporter = this.getTransporter();

    if (!transporter) {
      if (!this.warnedUnconfigured) {
        this.logger.warn(
          'SMTP is not configured (SMTP_USER / SMTP_APP_PASSWORD unset) — outbound mail is disabled.',
        );
        this.warnedUnconfigured = true;
      }
      return { sent: false, retryable: false };
    }

    try {
      await transporter.sendMail({
        from: `"${process.env.MAIL_FROM_NAME?.trim() || 'Yukizi'}" <${this.user}>`,
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
   * quota. An error with no SMTP code at all is network-level, so retry.
   */
  private isRetryable(error: unknown): boolean {
    const err = error as { responseCode?: number; code?: string };
    if (err?.code === 'EAUTH') return false;
    if (typeof err?.responseCode === 'number') {
      return err.responseCode >= 400 && err.responseCode < 500;
    }
    return true;
  }
}
