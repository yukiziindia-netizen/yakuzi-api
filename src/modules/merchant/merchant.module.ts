import { Module } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';
import { MerchantConfigService } from './merchant.config';
import { MerchantClient } from './merchant.client';
import { MerchantSyncService } from './merchant-sync.service';
import { MerchantController } from './merchant.controller';
import { MerchantCron } from './merchant.cron';

/**
 * Google Merchant Center integration: pushes the catalogue to Merchant Center
 * via the Merchant API (service-account auth), on a daily schedule and on
 * demand from the admin panel. Self-contained — depends only on Prisma.
 */
@Module({
  controllers: [MerchantController],
  providers: [
    PrismaService,
    MerchantConfigService,
    MerchantClient,
    MerchantSyncService,
    MerchantCron,
  ],
  exports: [MerchantSyncService],
})
export class MerchantModule {}
