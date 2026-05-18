import {
  Controller,
  Get,
  Patch,
  Param,
  Body,
  Query,
  UseGuards,
  HttpCode,
  HttpStatus,
  ParseUUIDPipe,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth } from '@nestjs/swagger';
import { Role } from '@prisma/client';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { SettlementsService } from './settlements.service';
import { MarkPaidDto } from './dto/mark-paid.dto';

@ApiTags('Settlements')
@ApiBearerAuth('JWT-auth')
@Controller()
export class SettlementsController {
  constructor(private readonly settlementsService: SettlementsService) {}

  // ─── SELLER ROUTES (/api/settlements/…) ───────────────

  @Get('settlements/seller')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.SELLER)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Get seller settlements' })
  @ApiResponse({ status: 200, description: 'Seller settlements returned' })
  async getSellerSettlements(
    @CurrentUser('id') userId: string,
    @Query('dateFrom') dateFrom?: string,
    @Query('dateTo') dateTo?: string,
  ) {
    const data = await this.settlementsService.getSellerSettlements(userId, dateFrom, dateTo);
    return { message: 'Settlements retrieved', data };
  }

  @Get('settlements/summary')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.SELLER)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Get seller settlement summary' })
  @ApiResponse({ status: 200, description: 'Summary returned' })
  async getSellerSummary(@CurrentUser('id') userId: string) {
    const data = await this.settlementsService.getSellerSummary(userId);
    return { message: 'Settlement summary retrieved', data };
  }

  @Get('settlements/history')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.SELLER)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Get seller payout history' })
  @ApiResponse({ status: 200, description: 'Payout history returned' })
  async getSellerHistory(@CurrentUser('id') userId: string) {
    const data = await this.settlementsService.getSellerHistory(userId);
    return { message: 'Payout history retrieved', data };
  }

  // NOTE: Admin settlement routes moved to AdminController (/api/admin/settlements/…)
}
