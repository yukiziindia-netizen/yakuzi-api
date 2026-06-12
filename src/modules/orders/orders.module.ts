import { Module } from '@nestjs/common';
import { OrdersService } from './orders.service';
import { OrdersController } from './orders.controller';
import { ShiprocketService } from './shiprocket.service';

@Module({
  controllers: [OrdersController],
  providers: [OrdersService, ShiprocketService],
  exports: [OrdersService, ShiprocketService],
})
export class OrdersModule {}
