import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';
import { MerchantConfigService } from './merchant.config';
import { MerchantClient } from './merchant.client';
import { mapToMerchantProduct, CatalogProductForFeed } from './merchant-product.mapper';

export interface SyncSummary {
  ran: boolean;
  reason?: string;
  total: number;
  pushed: number;
  skipped: number;
  failed: number;
  /** A few examples of why products were skipped/failed, for the admin. */
  problems: string[];
  dryRun: boolean;
  finishedAt: string;
}

// Push at most this many per run. The catalogue is ~100 items; the cap is a
// backstop against a future catalogue that grew without anyone revisiting this.
const BATCH_CAP = 1000;
// Products auto-expire from Merchant Center this many days after their last
// push, so anything that stops syncing drops off on its own.
const EXPIRE_DAYS = 28;

@Injectable()
export class MerchantSyncService {
  private readonly logger = new Logger(MerchantSyncService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: MerchantConfigService,
    private readonly client: MerchantClient,
  ) {}

  /**
   * Push every sellable product to Merchant Center.
   *
   * `dryRun` maps everything and reports what WOULD be sent without calling
   * Google — so an admin can see the outcome before turning the integration
   * on, and so this is exercisable without credentials.
   */
  async syncAll(opts: { dryRun?: boolean } = {}): Promise<SyncSummary> {
    const now = new Date();
    const finishedAt = () => new Date().toISOString();
    const cfg = await this.config.load();

    if (!opts.dryRun) {
      if (!cfg.enabled) {
        return this.empty('Merchant sync is switched off in settings.', !!opts.dryRun, finishedAt());
      }
      const problems = await this.config.problems();
      if (problems.length) {
        return this.empty(problems.join(' '), !!opts.dryRun, finishedAt());
      }
    }

    const rows = await this.fetchSellableProducts();
    const expirationDate = new Date(now.getTime() + EXPIRE_DAYS * 86400_000).toISOString();

    let pushed = 0;
    let skipped = 0;
    let failed = 0;
    const problems: string[] = [];

    for (const row of rows.slice(0, BATCH_CAP)) {
      const mapped = mapToMerchantProduct(row, { siteUrl: cfg.siteUrl, expirationDate });
      if (!mapped.ok) {
        skipped++;
        if (problems.length < 20) problems.push(`${mapped.offerId}: ${mapped.reason}`);
        continue;
      }
      if (opts.dryRun) {
        pushed++;
        continue;
      }
      try {
        await this.client.upsertProduct(cfg, mapped.product);
        pushed++;
      } catch (e) {
        failed++;
        if (problems.length < 20) problems.push(`${mapped.product.offerId}: ${(e as Error).message}`);
        this.logger.error(`merchant push failed for ${mapped.product.offerId}: ${(e as Error).message}`);
      }
    }

    const summary: SyncSummary = {
      ran: true,
      total: rows.length,
      pushed,
      skipped,
      failed,
      problems,
      dryRun: !!opts.dryRun,
      finishedAt: finishedAt(),
    };

    if (!opts.dryRun) await this.recordRun(summary);
    this.logger.log(
      `merchant sync ${opts.dryRun ? '(dry run) ' : ''}done: ${pushed} pushed, ${skipped} skipped, ${failed} failed of ${rows.length}`,
    );
    return summary;
  }

  /**
   * Active catalogue products with the storefront's own price rule applied:
   * cheapest live APPROVED offer, finalCustomerPayable falling back to that
   * offer's MRP; stock summed across every live approved offer's unexpired
   * batches. A product with no live approved offer comes back with price null
   * and the mapper drops it.
   */
  private async fetchSellableProducts(): Promise<CatalogProductForFeed[]> {
    const now = new Date();
    const products = await this.prisma.catalogProduct.findMany({
      where: { isActive: true, deletedAt: null },
      select: {
        id: true,
        slug: true,
        name: true,
        description: true,
        manufacturer: true,
        category: { select: { name: true } },
        images: {
          orderBy: [{ order: 'asc' }, { id: 'asc' }],
          take: 1,
          select: { url: true },
        },
        sellerOffers: {
          where: { isActive: true, deletedAt: null, approvalStatus: 'APPROVED' },
          orderBy: { mrp: 'asc' },
          select: {
            mrp: true,
            finalCustomerPayable: true,
            batches: {
              where: {
                stock: { gt: 0 },
                OR: [{ expiryDate: null }, { expiryDate: { gt: now } }],
              },
              select: { stock: true },
            },
          },
        },
      },
    });

    return products.map((p) => {
      const cheapest = p.sellerOffers[0];
      const price = cheapest ? Number(cheapest.finalCustomerPayable ?? cheapest.mrp) : null;
      const stock = p.sellerOffers.reduce(
        (sum, o) => sum + o.batches.reduce((s, b) => s + b.stock, 0),
        0,
      );
      return {
        id: p.id,
        slug: p.slug,
        name: p.name,
        description: p.description,
        manufacturer: p.manufacturer,
        category: p.category?.name ?? null,
        imageUrl: p.images[0]?.url ?? null,
        price,
        stock,
      };
    });
  }

  private empty(reason: string, dryRun: boolean, finishedAt: string): SyncSummary {
    return { ran: false, reason, total: 0, pushed: 0, skipped: 0, failed: 0, problems: [], dryRun, finishedAt };
  }

  /** Persist the last run so the admin panel can show when and how it went. */
  private async recordRun(summary: SyncSummary): Promise<void> {
    await this.prisma.systemSetting
      .upsert({
        where: { key: 'merchant.lastSync' },
        create: { key: 'merchant.lastSync', value: JSON.stringify(summary) },
        update: { value: JSON.stringify(summary) },
      })
      .catch((e) => this.logger.warn(`could not record merchant sync: ${(e as Error).message}`));
  }

  async lastRun(): Promise<SyncSummary | null> {
    const row = await this.prisma.systemSetting
      .findUnique({ where: { key: 'merchant.lastSync' } })
      .catch(() => null);
    if (!row) return null;
    try {
      return JSON.parse(row.value) as SyncSummary;
    } catch {
      return null;
    }
  }
}
