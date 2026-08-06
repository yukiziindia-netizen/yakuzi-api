import { Module } from '@nestjs/common';
import { OrdersService } from './orders.service';
import { OrdersController } from './orders.controller';
import { ShiprocketService } from './shiprocket.service';
import { InvoiceService } from './invoice.service';

@Module({
  controllers: [OrdersController],
  providers: [OrdersService, ShiprocketService, InvoiceService],
  exports: [OrdersService, ShiprocketService, InvoiceService],
})
export class OrdersModule {}
