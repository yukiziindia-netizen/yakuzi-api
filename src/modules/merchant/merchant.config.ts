import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';

/**
 * Where the Merchant Center integration reads its settings from.
 *
 * The account id, the data source id and the on/off switch are admin settings
 * (SystemSetting) — safe to show and edit in the panel. The service-account
 * CREDENTIAL is not: it is a private key, so it comes from an environment
 * variable, never the database, never an API response.
 */

export interface MerchantConfig {
  enabled: boolean;
  /** Merchant Center account id (digits). */
  accountId: string;
  /** The API data source created by Merchant Center's "Add products → API". */
  dataSourceId: string;
  /** Service-account key JSON, from GOOGLE_MERCHANT_CREDENTIALS. */
  credentials: { client_email: string; private_key: string } | null;
  siteUrl: string;
}

export const MERCHANT_KEYS = {
  enabled: 'merchant.enabled',
  accountId: 'merchant.accountId',
  dataSourceId: 'merchant.dataSourceId',
} as const;

@Injectable()
export class MerchantConfigService {
  private readonly logger = new Logger(MerchantConfigService.name);

  constructor(private readonly prisma: PrismaService) {}

  async load(): Promise<MerchantConfig> {
    const rows = await this.prisma.systemSetting
      .findMany({ where: { key: { in: Object.values(MERCHANT_KEYS) } } })
      .catch(() => [] as { key: string; value: string }[]);
    const byKey = new Map(rows.map((r) => [r.key, r.value]));
    const str = (k: string) => (byKey.get(k) ?? '').trim();

    return {
      enabled: str(MERCHANT_KEYS.enabled).toLowerCase() === 'true',
      accountId: str(MERCHANT_KEYS.accountId),
      dataSourceId: str(MERCHANT_KEYS.dataSourceId),
      credentials: this.readCredentials(),
      siteUrl: (process.env.NEXT_PUBLIC_SITE_URL || 'https://yukizi.com').replace(/\/$/, ''),
    };
  }

  /**
   * Reasons the integration cannot run, in words an admin can act on. Empty
   * means it is ready.
   */
  async problems(): Promise<string[]> {
    const cfg = await this.load();
    const out: string[] = [];
    if (!cfg.accountId) out.push('Merchant Center account id is not set.');
    if (!cfg.dataSourceId) out.push('Merchant Center API data source id is not set.');
    if (!cfg.credentials) {
      out.push('GOOGLE_MERCHANT_CREDENTIALS (the service-account key) is not set on the server.');
    }
    return out;
  }

  private readCredentials(): MerchantConfig['credentials'] {
    const raw = process.env.GOOGLE_MERCHANT_CREDENTIALS;
    if (!raw || !raw.trim()) return null;
    try {
      // Accept either raw JSON or base64-encoded JSON — a private key pasted
      // into a dashboard env field survives base64 far more reliably.
      const text = raw.trim().startsWith('{')
        ? raw
        : Buffer.from(raw, 'base64').toString('utf8');
      const parsed = JSON.parse(text);
      if (!parsed.client_email || !parsed.private_key) return null;
      return { client_email: parsed.client_email, private_key: parsed.private_key };
    } catch (e) {
      this.logger.error(
        `GOOGLE_MERCHANT_CREDENTIALS is set but is not valid JSON: ${(e as Error).message}`,
      );
      return null;
    }
  }
}
