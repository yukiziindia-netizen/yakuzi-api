import { Body, Controller, HttpCode, HttpStatus, Logger, Post } from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';
import { WebAnalyticsService } from './web-analytics.service';
import { CollectBatchDto } from './web-analytics.dto';

/**
 * Public ingestion endpoint, called by the buyer app's /api/track proxy
 * (which adds geo + UA). @SkipThrottle because batches arrive every few
 * seconds per active tab; abuse is bounded by the batch/body caps and by
 * everything being fire-and-forget on the client.
 *
 * Always answers 204: analytics failures are logged, never surfaced —
 * the storefront must behave identically whether tracking works or not.
 */
@Controller('analytics')
export class WebAnalyticsController {
  private readonly logger = new Logger(WebAnalyticsController.name);

  constructor(private readonly analytics: WebAnalyticsService) {}

  @Post('collect')
  @SkipThrottle()
  @HttpCode(HttpStatus.NO_CONTENT)
  async collect(@Body() batch: CollectBatchDto): Promise<void> {
    try {
      await this.analytics.ingest(batch);
    } catch (e) {
      this.analytics.health.errors += 1;
      this.logger.warn(`ingest failed: ${(e as Error).message}`);
    }
  }
}
