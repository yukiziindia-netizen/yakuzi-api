import { Global, Module } from '@nestjs/common';
import { MailService } from './mail.service';
import { BuyerEmailsService } from './buyer-emails.service';
import { LifecycleEmailsCron } from './lifecycle-emails.cron';

/**
 * `@Global` because the buyer lifecycle emails are sent from all over — auth,
 * orders, tickets, admin, and two cron jobs. Making the module global means
 * those call sites gain one constructor argument each instead of every module
 * along the way gaining an import.
 *
 * MailModule was previously imported explicitly by the four modules that
 * needed it; those imports still work and are left alone.
 */
@Global()
@Module({
  providers: [MailService, BuyerEmailsService, LifecycleEmailsCron],
  exports: [MailService, BuyerEmailsService],
})
export class MailModule {}
