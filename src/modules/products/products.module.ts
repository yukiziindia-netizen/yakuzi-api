import { Module } from '@nestjs/common';
import { ProductsController } from './products.controller';
import { ProductsService } from './products.service';
import { InventoryService } from './services/inventory.service';
import { SearchIndexService } from './services/search-index.service';
import { AnalyticsService } from './services/analytics.service';

@Module({
  controllers: [ProductsController],
  providers: [
    ProductsService,
    InventoryService,
    SearchIndexService,
    AnalyticsService,
  ],
  exports: [ProductsService, InventoryService, AnalyticsService],
})
export class ProductsModule {}
