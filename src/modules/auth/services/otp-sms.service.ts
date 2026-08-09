import { Injectable, Logger, HttpException, HttpStatus } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios from 'axios';

export interface OtpSendResult {
  /** True only when the gateway positively accepted the message. */
  success: boolean;
  /** Why it was not accepted — safe to log, never contains the OTP. */
  reason?: string;
  /** Raw gateway body, for diagnosing shapes not yet covered. */
  raw?: unknown;
}

@Injectable()
export class OtpSmsService {
  private readonly logger = new Logger(OtpSmsService.name);

  private readonly apiUrl: string;
  private readonly user: string;
  private readonly authkey: string;
  private readonly sender: string;
  private readonly entityId: string;
  private readonly templateId: string;
  private readonly rpt: string;
  private readonly messageTemplate: string;
  private readonly strict: boolean;

  constructor(private readonly configService: ConfigService) {
    // https, not http — the OTP text and the gateway credentials travel in
    // this request. Confirmed the gateway serves https with an identical
    // response body.
    this.apiUrl =
      this.configService.get<string>('NIMBUS_API_URL') ||
      'https://nimbusit.net/api/pushsms';

    this.user =
      this.configService.get<string>('NIMBUS_USER') || 'Yukizinet';

    this.authkey =
      this.configService.get<string>('NIMBUS_AUTHKEY') ||
      this.configService.get<string>('NIMBUS_KEY') ||
      this.configService.get<string>('NIMBUS_PASSWORD') ||
      '92pFS19Z3lkM';

    this.sender =
      this.configService.get<string>('NIMBUS_SENDER') || 'YUKIZI';

    this.entityId =
      this.configService.get<string>('NIMBUS_ENTITY_ID') ||
      '1701178401562319656';

    this.templateId =
      this.configService.get<string>('NIMBUS_TEMPLATE_ID') ||
      '1707178403027257823';

    this.rpt =
      this.configService.get<string>('NIMBUS_RPT') || '1';

    this.messageTemplate =
      this.configService.get<string>('NIMBUS_OTP_MESSAGE') ||
      'Dear User, use OTP {#var#} to securely access your YUKIZI account. Do not share it with anyone. - YUKIZI MARKET SERVICES';

    // When the gateway answers with something this service does not
    // recognise, strict mode reports a failure rather than assuming it
    // worked. Set OTP_SMS_STRICT=false to invert that if a legitimate
    // success payload turns out not to be covered below.
    this.strict =
      this.configService.get<string>('OTP_SMS_STRICT') !== 'false';

    if (!this.user || !this.authkey) {
      this.logger.warn(
        'Nimbus SMS credentials (NIMBUS_USER/NIMBUS_AUTHKEY) missing!',
      );
    }
  }

  // ==============================
  // MAIN FUNCTION
  // ==============================
  async sendOtp(phone: string, otp: string): Promise<OtpSendResult> {
    if (!phone || !otp) {
      throw new HttpException('Phone and OTP required', HttpStatus.BAD_REQUEST);
    }

    const formattedPhone = this.formatPhone(phone);

    // Replace {#var#}, {otp}, [otp], <otp>, or {%otp%} with generated OTP
    const message = this.messageTemplate.replace(
      /\{#var#\}|\{otp\}|\[otp\]|<otp>|\{%otp%\}/gi,
      otp,
    );

    // The rendered message contains the OTP, so it must never be logged.
    this.logger.log(`Sending OTP to ${this.maskPhone(formattedPhone)}`);

    const params = {
      user: this.user,
      authkey: this.authkey,
      sender: this.sender,
      mobile: formattedPhone,
      text: message,
      entityid: this.entityId,
      templateid: this.templateId,
      rpt: this.rpt,
    };

    try {
      const response = await this.retryRequest(() =>
        axios.get(this.apiUrl, {
          params,
          timeout: 5000,
        }),
      );

      const data = response.data;
      const verdict = this.interpretGatewayResponse(data);

      if (verdict.success) {
        this.logger.log(`SMS accepted by gateway: ${JSON.stringify(data)}`);
      } else {
        this.logger.error(
          `SMS REJECTED by gateway: ${verdict.reason} | raw: ${JSON.stringify(data)}`,
        );
      }

      return { success: verdict.success, reason: verdict.reason, raw: data };
    } catch (error: any) {
      const code = error?.code || error?.cause?.code;
      this.logger.error(
        `SMS FAILED: ${error.message} (Code: ${code || 'UNKNOWN'})`,
      );

      return {
        success: false,
        reason: `Gateway request failed: ${error.message}${code ? ` (${code})` : ''}`,
      };
    }
  }

  // ==============================
  // TRANSACTIONAL SMS (order status updates, etc.)
  // ==============================
  //
  // Deliberately NOT reusing sendOtp()/templateId above: Indian carriers
  // enforce TRAI DLT — every SMS template must be pre-registered per
  // templateid, and the OTP template is only approved for OTP wording.
  // Sending order-status text under the OTP template id would get silently
  // dropped or rejected by the carrier. This ships inert (like MailService
  // with no SMTP configured) until a real DLT-approved template exists and
  // NIMBUS_TRANSACTIONAL_TEMPLATE_ID is set to it.
  async sendTransactional(phone: string, message: string): Promise<OtpSendResult> {
    const templateId = this.configService.get<string>(
      'NIMBUS_TRANSACTIONAL_TEMPLATE_ID',
    );

    if (!templateId) {
      this.logger.warn(
        'NIMBUS_TRANSACTIONAL_TEMPLATE_ID is not set — transactional SMS needs its own DLT-approved template, cannot reuse the OTP one. Skipping.',
      );
      return { success: false, reason: 'not-configured' };
    }

    const formattedPhone = this.formatPhone(phone);

    const params = {
      user: this.user,
      authkey: this.authkey,
      sender: this.sender,
      mobile: formattedPhone,
      text: message,
      entityid: this.entityId,
      templateid: templateId,
      rpt: this.rpt,
    };

    try {
      const response = await this.retryRequest(() =>
        axios.get(this.apiUrl, { params, timeout: 5000 }),
      );

      const data = response.data;
      const verdict = this.interpretGatewayResponse(data);

      if (!verdict.success) {
        this.logger.error(
          `Transactional SMS REJECTED by gateway: ${verdict.reason} | raw: ${JSON.stringify(data)}`,
        );
      }

      return { success: verdict.success, reason: verdict.reason, raw: data };
    } catch (error: any) {
      const code = error?.code || error?.cause?.code;
      this.logger.error(
        `Transactional SMS FAILED: ${error.message} (Code: ${code || 'UNKNOWN'})`,
      );
      return {
        success: false,
        reason: `Gateway request failed: ${error.message}${code ? ` (${code})` : ''}`,
      };
    }
  }

  // ==============================
  // RESPONSE INTERPRETATION
  // ==============================
  //
  // The gateway's failure payload is:
  //
  //   {"RESPONSE":{"CODE":"200","INFO":"AUTHENTICATION FAILURE"},"STATUS":"ERROR"}
  //
  // Note CODE is "200" on a rejection, so the code alone can never be read as
  // success — STATUS has to be checked first. The previous implementation
  // looked for `status`, `responseCode`, `jobid` and `msgid` at the top level,
  // none of which exist in that shape, so every rejection scored as "not
  // success" and every acceptance did too.
  private interpretGatewayResponse(data: any): {
    success: boolean;
    reason?: string;
  } {
    const unknown = (detail: string) => ({
      success: !this.strict,
      reason: `Unrecognised gateway response: ${detail}`,
    });

    if (typeof data === 'string') {
      const text = data.trim();
      if (/^\d+$/.test(text)) return { success: true }; // bare job id
      if (/fail|error|invalid|reject|denied/i.test(text)) {
        return { success: false, reason: text };
      }
      if (/success|submitted|\bok\b/i.test(text)) return { success: true };
      return unknown(text);
    }

    if (data && typeof data === 'object') {
      const inner = data.RESPONSE ?? data.response ?? {};
      const status = String(data.STATUS ?? data.status ?? '').toUpperCase();
      const info = String(inner.INFO ?? inner.info ?? data.INFO ?? data.info ?? '');
      const code = String(inner.CODE ?? inner.code ?? data.responseCode ?? '');

      // Failure first — CODE "200" accompanies rejections.
      if (status === 'ERROR' || /fail|invalid|reject|denied/i.test(info)) {
        return {
          success: false,
          reason: info || `STATUS=${status || 'none'} CODE=${code || 'none'}`,
        };
      }

      if (status === 'OK' || status === 'SUCCESS') return { success: true };
      if (data.jobid || data.msgid || data.job_id || inner.JOBID) {
        return { success: true };
      }
      if (code === '200' && status) return { success: true };

      return unknown(JSON.stringify(data));
    }

    return unknown('empty body');
  }

  private maskPhone(phone: string): string {
    return phone.length <= 4 ? '****' : `${'*'.repeat(phone.length - 4)}${phone.slice(-4)}`;
  }

  // ==============================
  // PHONE FORMAT FIX
  // ==============================
  private formatPhone(phone: string): string {
    let clean = phone.replace(/\D/g, '');

    // Standard 10-digit Indian phone format for Nimbus IT pushsms
    if (clean.length === 12 && clean.startsWith('91')) {
      clean = clean.substring(2);
    } else if (clean.length === 11 && clean.startsWith('0')) {
      clean = clean.substring(1);
    }

    if (clean.length !== 10) {
      this.logger.warn(
        `Phone number ${phone} sanitized length is ${clean.length}`,
      );
    }

    return clean;
  }

  // ==============================
  // RETRY LOGIC
  // ==============================
  private async retryRequest(fn: () => Promise<any>, retries = 3) {
    let lastError;

    for (let i = 0; i < retries; i++) {
      try {
        return await fn();
      } catch (error: any) {
        lastError = error;
        const code = error?.code || error?.cause?.code;
        if (code === 'EAI_AGAIN' || code === 'ENOTFOUND' || code === 'ECONNREFUSED' || code === 'ETIMEDOUT') {
          this.logger.warn(`SMS Gateway Network/DNS Failure (${code}). Skipping redundant retries.`);
          break;
        }

        this.logger.warn(`Retry ${i + 1} failed`);

        if (i === retries - 1) break;
      }
    }

    throw lastError;
  }


  // ==============================
  // OPTIONAL: DEV MODE
  // ==============================
  logOtpForDevelopment(phone: string, otp: string) {
    this.logger.debug(`[DEV OTP] ${phone} → ${otp}`);
    return {
      success: true,
      message: 'OTP logged (dev mode)',
    };
  }

  // ==============================
  // CHECK CONFIG
  // ==============================
  isConfigured(): boolean {
    return !!(this.user && this.authkey);
  }

  getTemplate(): string {
    return this.messageTemplate;
  }
}
