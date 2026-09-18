import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../database/prisma.service';
import { QueryActivityDto } from './dto/query-activity.dto';

export interface RecordActivityInput {
  adminUserId: string | null;
  adminName: string;
  adminEmail?: string | null;
  section: string;
  method: string;
  path: string;
  description: string;
  targetType?: string | null;
  targetId?: string | null;
  targetLabel?: string | null;
  statusCode: number;
  success: boolean;
  changes?: unknown;
  ipAddress?: string | null;
  userAgent?: string | null;
}

/**
 * Reads and writes the admin activity log.
 *
 * There is no update method and no delete method, and that is the feature
 * rather than an omission — see the model comment in schema.prisma. If a
 * future requirement needs rows removed (a retention policy, say), it should
 * arrive as an explicit, separately-reviewed job, not as a method here that
 * the rest of the API could reach.
 */
@Injectable()
export class ActivityService {
  private readonly logger = new Logger(ActivityService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Writes one entry. Never throws.
   *
   * Called from an interceptor that runs after every admin write, so a failure
   * here — a database blip, a column that does not exist yet because the
   * migration has not been applied — must not turn a successful order update
   * into a 500 for the admin who made it. The audit trail is important; it is
   * not more important than the work it is describing.
   */
  async record(input: RecordActivityInput): Promise<void> {
    try {
      await this.prisma.adminActivityLog.create({
        data: {
          adminUserId: input.adminUserId,
          adminName: input.adminName,
          adminEmail: input.adminEmail ?? null,
          section: input.section,
          method: input.method,
          path: input.path,
          description: input.description,
          targetType: input.targetType ?? null,
          targetId: input.targetId ?? null,
          targetLabel: input.targetLabel ?? null,
          statusCode: input.statusCode,
          success: input.success,
          changes: (input.changes ?? undefined) as Prisma.InputJsonValue,
          ipAddress: input.ipAddress ?? null,
          userAgent: input.userAgent ?? null,
        },
      });
    } catch (error) {
      this.logger.error(
        `Failed to write activity log for ${input.method} ${input.path}: ${
          error instanceof Error ? error.message : 'unknown error'
        }`,
      );
    }
  }

  /** One page of entries, newest first, with the filters the panel offers. */
  async list(query: QueryActivityDto) {
    const page = Math.max(1, query.page ?? 1);
    const limit = Math.min(100, Math.max(1, query.limit ?? 25));

    const where: Prisma.AdminActivityLogWhereInput = {};

    if (query.adminUserId) where.adminUserId = query.adminUserId;
    if (query.section) where.section = query.section;
    if (query.method) where.method = query.method.toUpperCase();
    if (query.success !== undefined) where.success = query.success;

    if (query.dateFrom || query.dateTo) {
      where.createdAt = {};
      if (query.dateFrom) where.createdAt.gte = new Date(query.dateFrom);
      if (query.dateTo) {
        // An end date is inclusive of that whole day — a filter that silently
        // excluded today's entries would be read as "nothing happened".
        const to = new Date(query.dateTo);
        to.setHours(23, 59, 59, 999);
        where.createdAt.lte = to;
      }
    }

    if (query.search?.trim()) {
      const term = query.search.trim();
      where.OR = [
        { description: { contains: term, mode: 'insensitive' } },
        { adminName: { contains: term, mode: 'insensitive' } },
        { path: { contains: term, mode: 'insensitive' } },
        { targetLabel: { contains: term, mode: 'insensitive' } },
        { targetId: { contains: term, mode: 'insensitive' } },
      ];
    }

    const [rows, total] = await Promise.all([
      this.prisma.adminActivityLog.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.adminActivityLog.count({ where }),
    ]);

    return {
      data: rows,
      meta: {
        total,
        page,
        limit,
        totalPages: limit > 0 ? Math.ceil(total / limit) : 0,
      },
    };
  }

  /**
   * The values the filter dropdowns should offer.
   *
   * Built from what is actually IN the log rather than from the full admin
   * list, so the "who" filter never offers a name with zero entries behind it.
   * Admins who have since been deleted still appear, because their entries
   * still name them — which is the point of denormalising the name.
   */
  async filterOptions() {
    const [admins, sections] = await Promise.all([
      this.prisma.adminActivityLog.groupBy({
        by: ['adminUserId', 'adminName'],
        _count: { _all: true },
        orderBy: { _count: { adminUserId: 'desc' } },
      }),
      this.prisma.adminActivityLog.groupBy({
        by: ['section'],
        _count: { _all: true },
      }),
    ]);

    return {
      admins: admins
        .map((a) => ({
          adminUserId: a.adminUserId,
          adminName: a.adminName,
          count: a._count._all,
        }))
        .sort((a, b) => b.count - a.count),
      sections: sections
        .map((s) => ({ section: s.section, count: s._count._all }))
        .sort((a, b) => a.section.localeCompare(b.section)),
    };
  }
}
