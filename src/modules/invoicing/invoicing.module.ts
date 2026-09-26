import { Module } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';
import { InvoiceNumberingService } from './invoice-numbering.service';

/**
 * Shared invoice numbering. Both the consumer invoice (orders module) and the
 * commission invoice (settlements/admin) allocate from the same service, so the
 * two series stay independent but the allocation logic lives in one place.
 */
@Module({
  providers: [PrismaService, InvoiceNumberingService],
  exports: [InvoiceNumberingService],
})
export class InvoicingModule {}
