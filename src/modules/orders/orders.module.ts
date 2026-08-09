import { Module } from '@nestjs/common';
import { OrdersService } from './orders.service';
import { OrdersController } from './orders.controller';
import { ShiprocketService } from './shiprocket.service';
import { InvoiceService } from './invoice.service';
import { InvoicePdfService } from './invoice-pdf.service';
import { InvoiceEmailService } from './invoice-email.service';
import { MailModule } from '../mail/mail.module';
import { AuthModule } from '../auth/auth.module';

@Module({
  imports: [MailModule, AuthModule],
  controllers: [OrdersController],
  providers: [
    OrdersService,
    ShiprocketService,
    InvoiceService,
    InvoicePdfService,
    InvoiceEmailService,
  ],
  exports: [
    OrdersService,
    ShiprocketService,
    InvoiceService,
    InvoicePdfService,
    InvoiceEmailService,
  ],
})
export class OrdersModule {}
