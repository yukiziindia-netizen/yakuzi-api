import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { MerchantSyncService } from './merchant-sync.service';

/**
 * Keeps Merchant Center current without anyone pressing a button.
 *
 * Once a day is the right cadence for a ~100-item catalogue: prices and stock
 * move, but not minute to minute, and every push also refreshes each product's
 * expiry, so nothing drops off for being stale. syncAll is a no-op when the
 * integration is switched off, so this is safe to leave scheduled always.
 */
@Injectable()
export class MerchantCron {
  private readonly logger = new Logger(MerchantCron.name);

  constructor(private readonly sync: MerchantSyncService) {}

  @Cron(CronExpression.EVERY_DAY_AT_3AM, { timeZone: 'Asia/Kolkata' })
  async daily(): Promise<void> {
    try {
      const summary = await this.sync.syncAll();
      if (!summary.ran) {
        this.logger.log(`merchant daily sync skipped: ${summary.reason}`);
      }
    } catch (e) {
      // A background job must never crash the process.
      this.logger.error(`merchant daily sync errored: ${(e as Error).message}`);
    }
  }
}
