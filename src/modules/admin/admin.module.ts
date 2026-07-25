import { Module } from '@nestjs/common';
import { AdminController, PublicConfigController } from './admin.controller';
import { AdminService } from './admin.service';

@Module({
  controllers: [AdminController, PublicConfigController],
  providers: [AdminService],
})
export class AdminModule {}

