import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { Role } from '@prisma/client';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { AdminAccessGuard } from '../../common/admin-access/admin-access.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { ActivityService } from './activity.service';
import { QueryActivityDto } from './dto/query-activity.dto';
import { ALL_SECTIONS } from './activity-section';

/**
 * Read-only view of the admin activity log.
 *
 * ⚠️ There is intentionally NO delete, purge, edit or export-and-clear route
 * here, and none should be added. The whole value of this table is that an
 * admin cannot quietly remove the record of something they did, and that
 * guarantee lives in the absence of these routes rather than in a permission
 * check that a future change might relax.
 *
 * Access is the `activity` tab grant, assigned on the same screen as every
 * other tab. Super Admins hold it implicitly (any admin without explicit
 * grants reads as Super), so nobody loses visibility when this ships; a
 * restricted admin sees the log only if it is ticked for them.
 */
@ApiTags('Admin Activity')
@ApiBearerAuth()
@Controller('admin/activity')
@UseGuards(JwtAuthGuard, RolesGuard, AdminAccessGuard)
@Roles(Role.ADMIN)
export class ActivityController {
  constructor(private readonly activity: ActivityService) {}

  @Get()
  @ApiOperation({ summary: 'List admin activity, newest first' })
  @ApiResponse({ status: 200, description: 'Paginated activity entries' })
  @ApiResponse({ status: 403, description: 'Activity log access not granted' })
  async list(@Query() query: QueryActivityDto) {
    const result = await this.activity.list(query);
    return {
      message: 'Activity log retrieved',
      data: result.data,
      meta: result.meta,
    };
  }

  /**
   * Values for the filter dropdowns.
   *
   * `admins` and `sections` come from what is actually in the log, so the
   * filters never offer an option that returns nothing. `allSections` is the
   * full list of possible sections, for labelling.
   */
  @Get('filters')
  @ApiOperation({ summary: 'Admins and sections present in the log' })
  @ApiResponse({ status: 200, description: 'Filter options returned' })
  async filters() {
    const data = await this.activity.filterOptions();
    return {
      message: 'Activity filters retrieved',
      data: { ...data, allSections: ALL_SECTIONS },
    };
  }
}
