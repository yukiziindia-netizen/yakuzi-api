import { Module } from '@nestjs/common';
import { DatabaseModule } from '../../database/database.module';
import { SeoController } from './seo.controller';
import { AdminSeoController } from './seo-admin.controller';
import { SeoService } from './seo.service';
import { SeoRedirectsService } from './seo-redirects.service';
import { SeoKeywordsService } from './seo-keywords.service';

@Module({
  imports: [DatabaseModule],
  controllers: [SeoController, AdminSeoController],
  providers: [SeoService, SeoRedirectsService, SeoKeywordsService],
  exports: [SeoService],
})
export class SeoModule {}
