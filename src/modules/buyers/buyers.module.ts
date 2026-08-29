import { Module } from '@nestjs/common';
import { BuyersController } from './buyers.controller';
import { BuyersService } from './buyers.service';
import { VerificationModule } from '../verification/verification.module';
import { MailModule } from '../mail/mail.module';

@Module({
  imports: [VerificationModule, MailModule],
  controllers: [BuyersController],
  providers: [BuyersService],
  exports: [BuyersService],
})
export class BuyersModule {}
