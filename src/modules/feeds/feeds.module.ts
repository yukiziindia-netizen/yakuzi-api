import { Module } from '@nestjs/common';
import { FeedsController } from './feeds.controller';
import { FeedsService } from './feeds.service';
import { ProductsModule } from '../products/products.module';

@Module({
  imports: [ProductsModule],
  controllers: [FeedsController],
  providers: [FeedsService],
})
export class FeedsModule {}
