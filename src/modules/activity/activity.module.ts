import { Global, Module } from '@nestjs/common';
import { APP_INTERCEPTOR } from '@nestjs/core';
import { ActivityController } from './activity.controller';
import { ActivityService } from './activity.service';
import { ActivityLogInterceptor } from './activity-log.interceptor';

/**
 * Admin activity log: capture, and a read-only view of what was captured.
 *
 * `@Global` so `ActivityService` is injectable anywhere without importing this
 * module — matching how NotificationsModule is wired in this codebase, and
 * needed because the interceptor below is registered application-wide.
 *
 * Registering via APP_INTERCEPTOR is what makes this feature additive: every
 * admin write is recorded without a single existing controller or service
 * being edited. Nothing that works today can break because of a change made
 * here — the worst case is a missing log entry, which the service swallows.
 */
@Global()
@Module({
  controllers: [ActivityController],
  providers: [
    ActivityService,
    { provide: APP_INTERCEPTOR, useClass: ActivityLogInterceptor },
  ],
  exports: [ActivityService],
})
export class ActivityModule {}
