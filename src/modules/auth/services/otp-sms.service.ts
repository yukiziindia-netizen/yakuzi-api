import { Injectable, Logger, HttpException, HttpStatus } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios from 'axios';

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

  constructor(private readonly configService: ConfigService) {
    this.apiUrl =
      this.configService.get<string>('NIMBUS_API_URL') ||
      'http://nimbusit.net/api/pushsms';

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

    if (!this.user || !this.authkey) {
      this.logger.warn(
        'Nimbus SMS credentials (NIMBUS_USER/NIMBUS_AUTHKEY) missing!',
      );
    }
  }

  // ==============================
  // MAIN FUNCTION
  // ==============================
  async sendOtp(phone: string, otp: string): Promise<any> {
    if (!phone || !otp) {
      throw new HttpException('Phone and OTP required', HttpStatus.BAD_REQUEST);
    }

    const formattedPhone = this.formatPhone(phone);

    // Replace {#var#}, {otp}, [otp], <otp>, or {%otp%} with generated OTP
    const message = this.messageTemplate.replace(
      /\{#var#\}|\{otp\}|\[otp\]|<otp>|\{%otp%\}/gi,
      otp,
    );

    this.logger.log(`Final message being sent: ${message}`);
    this.logger.log(`Sending OTP to ${formattedPhone}`);

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
          timeout: 10000,
        }),
      );

      const data = response.data;

      const isSuccess =
        typeof data === 'string'
          ? data.toLowerCase().includes('success') ||
            data.toLowerCase().includes('ok') ||
            data.toLowerCase().includes('submitted') ||
            /^\d+$/.test(data.trim())
          : data?.status === 'success' ||
            data?.status === 'OK' ||
            data?.status === 200 ||
            data?.responseCode === '200' ||
            !!data?.jobid ||
            !!data?.msgid;

      if (!isSuccess) {
        this.logger.warn(`SMS response received: ${JSON.stringify(data)}`);
      }

      this.logger.log(`SMS Response: ${JSON.stringify(data)}`);

      return {
        success: isSuccess,
        response: data,
      };
    } catch (error) {
      this.logger.error(`SMS FAILED: ${error.message}`);

      throw new HttpException(
        'Failed to send OTP',
        HttpStatus.SERVICE_UNAVAILABLE,
      );
    }
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
      } catch (error) {
        lastError = error;
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
