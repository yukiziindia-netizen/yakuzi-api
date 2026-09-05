import { Injectable, Logger, InternalServerErrorException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as crypto from 'crypto';

/**
 * AES-256-GCM envelope for integration credentials at rest.
 *
 * Channel credentials (Shopify access tokens, WooCommerce consumer secrets,
 * Amazon refresh tokens) are long-lived bearer secrets: anyone holding one can
 * act as the seller on that platform until it is revoked. A database dump must
 * therefore not be enough to use them.
 *
 * Format: v1.<iv-b64>.<authTag-b64>.<ciphertext-b64>
 * The version prefix is what makes a future key rotation possible without
 * guessing how any given row was written.
 */
@Injectable()
export class EncryptionService {
  private readonly logger = new Logger(EncryptionService.name);
  private static readonly ALGORITHM = 'aes-256-gcm';
  private static readonly IV_BYTES = 12; // GCM standard
  static readonly KEY_VERSION = 1;

  constructor(private readonly configService: ConfigService) {}

  /**
   * The raw key material. Accepts a 64-char hex string or a 44-char base64
   * string — both decode to the 32 bytes AES-256 requires.
   */
  private getKey(): Buffer | null {
    const raw = this.configService
      .get<string>('INTEGRATIONS_ENCRYPTION_KEY')
      ?.trim();
    if (!raw) return null;

    let key: Buffer;
    if (/^[0-9a-fA-F]{64}$/.test(raw)) {
      key = Buffer.from(raw, 'hex');
    } else {
      key = Buffer.from(raw, 'base64');
    }

    if (key.length !== 32) {
      this.logger.error(
        `INTEGRATIONS_ENCRYPTION_KEY must decode to 32 bytes (got ${key.length}). Generate one with: openssl rand -hex 32`,
      );
      return null;
    }
    return key;
  }

  /**
   * Whether credential storage is usable. Callers check this BEFORE starting
   * an authorisation flow, so a seller is told up front rather than after
   * approving Yukizi on the provider's consent screen.
   */
  isConfigured(): boolean {
    return this.getKey() !== null;
  }

  /**
   * Encrypts a credential bundle. Throws rather than silently storing
   * plaintext — a misconfigured key must never degrade into "tokens in the
   * clear".
   */
  encrypt(payload: Record<string, unknown>): string {
    const key = this.getKey();
    if (!key) {
      throw new InternalServerErrorException(
        'Integration credential storage is not configured.',
      );
    }

    const iv = crypto.randomBytes(EncryptionService.IV_BYTES);
    const cipher = crypto.createCipheriv(
      EncryptionService.ALGORITHM,
      key,
      iv,
    ) as crypto.CipherGCM;
    const ciphertext = Buffer.concat([
      cipher.update(JSON.stringify(payload), 'utf8'),
      cipher.final(),
    ]);
    const authTag = cipher.getAuthTag();

    return [
      `v${EncryptionService.KEY_VERSION}`,
      iv.toString('base64'),
      authTag.toString('base64'),
      ciphertext.toString('base64'),
    ].join('.');
  }

  /**
   * Decrypts a bundle. Returns null on any failure (missing key, tampered
   * ciphertext, unknown version) so callers degrade to "this connection needs
   * reauthorising" instead of throwing raw crypto errors at a seller.
   *
   * GCM authentication means a tampered row fails here rather than silently
   * returning attacker-chosen credentials.
   */
  decrypt<T = Record<string, unknown>>(value: string | null): T | null {
    if (!value) return null;
    const key = this.getKey();
    if (!key) return null;

    const parts = value.split('.');
    if (parts.length !== 4 || parts[0] !== `v${EncryptionService.KEY_VERSION}`) {
      this.logger.warn(
        'Stored integration credential has an unrecognised envelope format',
      );
      return null;
    }

    try {
      const [, ivB64, tagB64, dataB64] = parts;
      const decipher = crypto.createDecipheriv(
        EncryptionService.ALGORITHM,
        key,
        Buffer.from(ivB64, 'base64'),
      ) as crypto.DecipherGCM;
      decipher.setAuthTag(Buffer.from(tagB64, 'base64'));
      const plaintext = Buffer.concat([
        decipher.update(Buffer.from(dataB64, 'base64')),
        decipher.final(),
      ]).toString('utf8');
      return JSON.parse(plaintext) as T;
    } catch {
      // Deliberately no error detail: the message could describe the secret.
      this.logger.warn('Failed to decrypt an integration credential bundle');
      return null;
    }
  }
}
