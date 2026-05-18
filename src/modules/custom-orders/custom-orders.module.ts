import { Module } from '@nestjs/common';
import { CustomOrdersService } from './custom-orders.service';
import { CustomOrdersController } from './custom-orders.controller';

@Module({
  providers: [CustomOrdersService],
  controllers: [CustomOrdersController],
  exports: [CustomOrdersService],
})
export class CustomOrdersModule {}
