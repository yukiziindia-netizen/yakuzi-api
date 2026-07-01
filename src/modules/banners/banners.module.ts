import { Module } from '@nestjs/common';
import { BannersController, AdminBannersController } from './banners.controller';
import { BannersService } from './banners.service';
import { DatabaseModule } from '../../database/database.module';
import { StorageModule } from '../storage/storage.module';

@Module({
  imports: [DatabaseModule, StorageModule],
  controllers: [BannersController, AdminBannersController],
  providers: [BannersService],
  exports: [BannersService],
})
export class BannersModule {}
