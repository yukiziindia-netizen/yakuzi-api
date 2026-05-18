import { Module } from '@nestjs/common';
import { IdfyService } from './idfy.service';
import { VerificationController } from './verification.controller';

@Module({
  controllers: [VerificationController],
  providers: [IdfyService],
  exports: [IdfyService],
})
export class VerificationModule {}
