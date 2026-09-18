import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import { Role } from '@prisma/client';
import { Observable, tap } from 'rxjs';
import { ActivityService } from './activity.service';
import { describeAction, extractLabel, redactBody } from './activity-describe';
import { resolveSection } from './activity-section';

/**
 * Records every admin write action, centrally.
 *
 * Deliberately an interceptor rather than a call at each of the ~200 admin
 * handlers. Two reasons, and the second is the one that matters:
 *
 *  1. It adds behaviour without editing a single existing handler, which on a
 *     live site is the difference between a change that cannot break checkout
 *     and one that might.
 *  2. An admin route added six months from now is logged the day it ships.
 *     Per-handler calls are only as complete as the last person to remember
 *     one, and the gaps are invisible — an action that was never logged looks
 *     exactly like an action that never happened.
 *
 * What it records, and what it does not:
 *
 *  - ADMIN role only. Buyer and seller traffic is out of scope by design.
 *  - Writes only. GETs are skipped: an admin opening a list is not an event
 *    worth keeping, and logging reads would bury the actions that matter
 *    under thousands of page views.
 *  - Failures as well as successes. An admin being refused something is
 *    exactly the kind of thing this table exists to show.
 *  - Never the activity log's own routes, which would be circular.
 */
@Injectable()
export class ActivityLogInterceptor implements NestInterceptor {
  /** Methods treated as a change worth recording. */
  private static readonly WRITE_METHODS = new Set([
    'POST',
    'PATCH',
    'PUT',
    'DELETE',
  ]);

  constructor(private readonly activity: ActivityService) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    if (context.getType() !== 'http') return next.handle();

    const request = context.switchToHttp().getRequest();
    const method: string = (request?.method ?? '').toUpperCase();

    if (!ActivityLogInterceptor.WRITE_METHODS.has(method)) {
      return next.handle();
    }

    const user = request?.user;
    // `user` is populated by JwtAuthGuard, which runs before interceptors.
    // Unauthenticated traffic and non-admins are not this table's business.
    if (!user || user.role !== Role.ADMIN) return next.handle();

    const rawPath: string = request?.originalUrl ?? request?.url ?? '';
    const path = rawPath.split('?')[0];

    // Reading the log is itself an admin route; recording those would fill the
    // table with entries about looking at the table.
    if (path.startsWith('/admin/activity')) return next.handle();

    // The body is captured BEFORE the handler runs. Some handlers mutate the
    // DTO they are given, so reading it afterwards can show values the admin
    // never sent.
    const body = request?.body;
    const described = describeAction(method, path, body);
    const snapshot = {
      section: resolveSection(path),
      method,
      path,
      description: described.description,
      targetType: described.targetType ?? null,
      targetId: described.targetId ?? null,
      targetLabel: extractLabel(body) ?? null,
      changes: redactBody(body),
      adminUserId: user.id ?? user.sub ?? null,
      adminName: this.nameOf(user),
      adminEmail: user.email ?? null,
      ipAddress: this.ipOf(request),
      userAgent: this.truncate(request?.headers?.['user-agent'], 300),
    };

    const response = context.switchToHttp().getResponse();

    return next.handle().pipe(
      tap({
        next: () => {
          void this.activity.record({
            ...snapshot,
            statusCode: response?.statusCode ?? 200,
            success: true,
          });
        },
        error: (error: unknown) => {
          const status =
            (error as { status?: number })?.status ??
            (error as { statusCode?: number })?.statusCode ??
            500;
          void this.activity.record({
            ...snapshot,
            description: `${snapshot.description} — failed`,
            statusCode: status,
            success: false,
          });
        },
      }),
    );
  }

  /**
   * The best name available for the acting admin.
   *
   * Stored as a snapshot on the row, so this is the name the log will show
   * forever — including after the account is renamed or deleted. Falls back
   * through the identifiers the JWT payload and user record actually carry,
   * and finally to a marker rather than an empty string, because a blank
   * "who" column is worse than an honest unknown.
   */
  private nameOf(user: Record<string, any>): string {
    return (
      user?.adminProfile?.displayName ||
      user?.name ||
      user?.displayName ||
      user?.email ||
      user?.phone ||
      user?.username ||
      'Unknown admin'
    );
  }

  /**
   * Caller IP, preferring the forwarded header because the API sits behind a
   * proxy — `request.ip` there is the proxy, which is the same value for
   * everyone and therefore useless for accountability.
   */
  private ipOf(request: any): string | null {
    const forwarded = request?.headers?.['x-forwarded-for'];
    if (typeof forwarded === 'string' && forwarded.trim()) {
      return forwarded.split(',')[0].trim();
    }
    if (Array.isArray(forwarded) && forwarded.length) {
      return String(forwarded[0]).trim();
    }
    return request?.ip ?? request?.socket?.remoteAddress ?? null;
  }

  private truncate(value: unknown, max: number): string | null {
    if (typeof value !== 'string' || !value) return null;
    return value.length > max ? value.slice(0, max) : value;
  }
}
