import { Module } from '@nestjs/common';
import {
  HomepageSectionsController,
  AdminHomepageSectionsController,
} from './homepage-sections.controller';
import { HomepageSectionsService } from './homepage-sections.service';
import { DatabaseModule } from '../../database/database.module';
import { ProductsModule } from '../products/products.module';

@Module({
  imports: [DatabaseModule, ProductsModule],
  controllers: [HomepageSectionsController, AdminHomepageSectionsController],
  providers: [HomepageSectionsService],
  exports: [HomepageSectionsService],
})
export class HomepageSectionsModule {}
