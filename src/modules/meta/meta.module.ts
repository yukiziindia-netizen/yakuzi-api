import { Global, Module } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';
import { MetaConfigService } from './meta.config';
import { MetaCapiService } from './meta-capi.service';

/**
 * Meta Conversions API. Global so the payment path can emit a server-side
 * Purchase without a web of module imports — the same shape WebAnalyticsModule
 * uses for exactly the same reason.
 */
@Global()
@Module({
  providers: [PrismaService, MetaConfigService, MetaCapiService],
  exports: [MetaCapiService, MetaConfigService],
})
export class MetaModule {}
