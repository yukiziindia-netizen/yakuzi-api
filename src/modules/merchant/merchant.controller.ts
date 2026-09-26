import { Controller, Post, Get, Body, HttpCode, HttpStatus, UseGuards } from '@nestjs/common';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import { Role } from '@prisma/client';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { AdminAccessGuard } from '../../common/admin-access';
import { Roles } from '../../common/decorators/roles.decorator';
import { MerchantSyncService } from './merchant-sync.service';
import { MerchantConfigService } from './merchant.config';

/**
 * Admin controls for the Google Merchant Center integration. Everything here
 * is admin-only and gated by the `settings` access tab (writeLevel full for
 * the sync, view for status), so it reuses the existing System-settings
 * permission rather than inventing a new one.
 */
@ApiTags('Merchant Center')
@Controller('admin/merchant')
@UseGuards(JwtAuthGuard, RolesGuard, AdminAccessGuard)
@Roles(Role.ADMIN)
export class MerchantController {
  constructor(
    private readonly sync: MerchantSyncService,
    private readonly config: MerchantConfigService,
  ) {}

  /** Readiness + the last run, for the settings panel. */
  @Get('status')
  @ApiOperation({ summary: 'Merchant Center integration status' })
  async status() {
    const [problems, last] = await Promise.all([
      this.config.problems(),
      this.sync.lastRun(),
    ]);
    return { ready: problems.length === 0, problems, lastSync: last };
  }

  /**
   * Run a sync now. `{ "dryRun": true }` reports what would be sent without
   * calling Google or needing credentials — the safe way to check the mapping
   * before going live.
   */
  @Post('sync')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Push products to Merchant Center now' })
  async runSync(@Body() body: { dryRun?: boolean } = {}) {
    return this.sync.syncAll({ dryRun: !!body?.dryRun });
  }
}
