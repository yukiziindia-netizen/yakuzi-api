import { Module } from '@nestjs/common';
import { AdminController, PublicConfigController } from './admin.controller';
import { AdminService } from './admin.service';
import { OrdersModule } from '../orders/orders.module';
import { SellersModule } from '../sellers/sellers.module';

@Module({
  imports: [OrdersModule, SellersModule],
  controllers: [AdminController, PublicConfigController],
  providers: [AdminService],
})
export class AdminModule {}

