import { Injectable, Logger, HttpException, HttpStatus } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios from 'axios';

@Injectable()
export class OtpSmsService {
  private readonly logger = new Logger(OtpSmsService.name);

  private readonly apiUrl: string;
  private readonly user: string;
  private readonly password: string;
  private readonly sender: string;
  private readonly entityId: string;
  private readonly templateId: string;
  private readonly messageTemplate: string;

  constructor(private readonly configService: ConfigService) {
    this.apiUrl =
      this.configService.get<string>('NIMBUS_API_URL') ||
      'http://nimbusit.biz/api/SmsApi/SendSingleApi';

    this.user = this.configService.get<string>('NIMBUS_USER') || '';

    // Support both NIMBUS_PASSWORD and NIMBUS_KEY (as mentioned in docs)
    this.password =
      this.configService.get<string>('NIMBUS_PASSWORD') ||
      this.configService.get<string>('NIMBUS_KEY') ||
      '';

    this.sender = this.configService.get<string>('NIMBUS_SENDER') || 'PHABAG';
    this.entityId = this.configService.get<string>('NIMBUS_ENTITY_ID') || '';
    this.templateId = this.configService.get<string>('NIMBUS_TEMPLATE_ID') || '';

    this.messageTemplate =
      this.configService.get<string>('NIMBUS_OTP_MESSAGE') ||
      'Welcome to Pharmabag. Use OTP {otp} to login to your Pharmabag account';

    if (!this.user || !this.password) {
      this.logger.warn('Nimbus SMS credentials (NIMBUS_USER/NIMBUS_KEY) missing!');
    }
  }

  // ==============================
  // MAIN FUNCTION
  // ==============================
  async sendOtp(phone: string, otp: string): Promise<any> {
    if (!phone || !otp) {
      throw new HttpException(
        'Phone and OTP required',
        HttpStatus.BAD_REQUEST,
      );
    }

    const formattedPhone = this.formatPhone(phone);

    // Robust replacement: handles {otp}, [otp], <otp>, {#var#}, or {%otp%} case-insensitively
    // We intentionally do not use \botp\b to avoid matching the literal word "OTP" in the template.
    const message = this.messageTemplate.replace(/\{otp\}|\[otp\]|<otp>|\{#var#\}|\{%otp%\}/gi, otp);

    this.logger.log(`Final message being sent: ${message}`);
    this.logger.log(`Sending OTP to ${formattedPhone}`);

    const params = {
      UserID: this.user,
      Password: this.password,
      SenderID: this.sender,
      Phno: formattedPhone,
      Msg: message,
      EntityID: this.entityId,
      TemplateID: this.templateId,
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
          ? data.toLowerCase().includes('success')
          : data?.status === 'success';

      if (!isSuccess) {
        this.logger.warn(`SMS may have failed: ${JSON.stringify(data)}`);
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

    // If it's a standard 10-digit Indian number, prepend 91
    if (clean.length === 10) {
      clean = '91' + clean;
    }

    // India format: 0XXXXXXXXXX → 91XXXXXXXXXX
    if (clean.startsWith('0') && clean.length === 11) {
      clean = '91' + clean.substring(1);
    }

    if (clean.length < 12) {
      this.logger.warn(`Phone number ${phone} may be too short for international format`);
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
    return !!(this.user && this.password);
  }

  getTemplate(): string {
    return this.messageTemplate;
  }
}