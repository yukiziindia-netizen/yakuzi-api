import { Module } from '@nestjs/common';
import { OrdersService } from './orders.service';
import { OrdersController } from './orders.controller';
import { ShiprocketService } from './shiprocket.service';
import { ShiprocketSyncService } from './shiprocket-sync.service';
import { CheckoutAbandonmentSweepService } from './checkout-abandonment-sweep.service';
import { InvoiceService } from './invoice.service';
import { InvoicePdfService } from './invoice-pdf.service';
import { InvoiceEmailService } from './invoice-email.service';
import { SellerOrderNotifierService } from './seller-order-notifier.service';
import { MailModule } from '../mail/mail.module';
import { AuthModule } from '../auth/auth.module';

@Module({
  imports: [MailModule, AuthModule],
  controllers: [OrdersController],
  providers: [
    OrdersService,
    ShiprocketService,
    ShiprocketSyncService,
    CheckoutAbandonmentSweepService,
    InvoiceService,
    InvoicePdfService,
    InvoiceEmailService,
    SellerOrderNotifierService,
  ],
  exports: [
    OrdersService,
    ShiprocketService,
    InvoiceService,
    InvoicePdfService,
    InvoiceEmailService,
    SellerOrderNotifierService,
  ],
})
export class OrdersModule {}
