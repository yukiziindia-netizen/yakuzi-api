import { Module } from '@nestjs/common';
import { SellersController } from './sellers.controller';
import { SellersService } from './sellers.service';
import { VerificationModule } from '../verification/verification.module';
import { MailModule } from '../mail/mail.module';

@Module({
  imports: [VerificationModule, MailModule],
  controllers: [SellersController],
  providers: [SellersService],
  exports: [SellersService],
})
export class SellersModule {}
