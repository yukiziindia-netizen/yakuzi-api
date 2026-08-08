import { Module } from '@nestjs/common';
import { AdminController, PublicConfigController } from './admin.controller';
import { AdminService } from './admin.service';
import { OrdersModule } from '../orders/orders.module';

@Module({
  imports: [OrdersModule],
  controllers: [AdminController, PublicConfigController],
  providers: [AdminService],
})
export class AdminModule {}

