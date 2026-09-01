import { Module } from '@nestjs/common';
import { InstagramService } from './instagram.service';
import { InstagramController, AdminInstagramController } from './instagram.controller';
import { DatabaseModule } from '../../database/database.module';

@Module({
  imports: [DatabaseModule],
  controllers: [InstagramController, AdminInstagramController],
  providers: [InstagramService],
  exports: [InstagramService],
})
export class InstagramModule {}
