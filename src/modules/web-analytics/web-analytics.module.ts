import { Global, Module } from '@nestjs/common';
import { WebAnalyticsService } from './web-analytics.service';
import { WebAnalyticsReportsService } from './web-analytics-reports.service';
import { WebAnalyticsController } from './web-analytics.controller';
import { WebAnalyticsAdminController } from './web-analytics-admin.controller';

/**
 * Global so auth/orders/payments can emit server-side truth events
 * (signup_completed, login, order_placed, purchase) without import churn.
 */
@Global()
@Module({
  controllers: [WebAnalyticsController, WebAnalyticsAdminController],
  providers: [WebAnalyticsService, WebAnalyticsReportsService],
  exports: [WebAnalyticsService],
})
export class WebAnalyticsModule {}
