import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';

/**
 * Where the Meta integration reads its settings.
 *
 * The Pixel ID and the on/off switch are admin settings (SystemSetting) — the
 * Pixel ID is public anyway (it ships in the browser). The Conversions API
 * ACCESS TOKEN is a secret: it comes from an environment variable, never the
 * database, never a public config response.
 */
export interface MetaConfig {
  enabled: boolean;
  pixelId: string;
  accessToken: string;
  /** Optional: routes CAPI events to Meta's Test Events tab while verifying. */
  testEventCode: string;
  siteUrl: string;
}

export const META_KEYS = {
  enabled: 'metaPixel.enabled',
  pixelId: 'metaPixel.pixelId',
} as const;

@Injectable()
export class MetaConfigService {
  constructor(private readonly prisma: PrismaService) {}

  async load(): Promise<MetaConfig> {
    const rows = await this.prisma.systemSetting
      .findMany({ where: { key: { in: Object.values(META_KEYS) } } })
      .catch(() => [] as { key: string; value: string }[]);
    const byKey = new Map(rows.map((r) => [r.key, r.value]));
    return {
      enabled: (byKey.get(META_KEYS.enabled) ?? '').trim().toLowerCase() === 'true',
      pixelId: (byKey.get(META_KEYS.pixelId) ?? '').trim(),
      accessToken: (process.env.META_CAPI_ACCESS_TOKEN ?? '').trim(),
      testEventCode: (process.env.META_CAPI_TEST_EVENT_CODE ?? '').trim(),
      siteUrl: (process.env.NEXT_PUBLIC_SITE_URL || 'https://yukizi.com').replace(/\/$/, ''),
    };
  }

  /** True when a server-side event can actually be sent. */
  canSendServerEvents(cfg: MetaConfig): boolean {
    return cfg.enabled && !!cfg.pixelId && !!cfg.accessToken;
  }
}
