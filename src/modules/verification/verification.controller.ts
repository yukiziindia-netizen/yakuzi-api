import {
  Controller,
  Post,
  Body,
  HttpCode,
  HttpStatus,
  BadRequestException,
  UseGuards,
  Logger,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { IdfyService } from './idfy.service';
import { VerifyGstPanDto, VerificationType } from './dto/verify-gst-pan.dto';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';

@ApiTags('Verification')
@Controller('verification')
export class VerificationController {
  private readonly logger = new Logger(VerificationController.name);

  constructor(private readonly idfyService: IdfyService) {}

  /**
   * GST/PAN lookup, via the paid IDfy service.
   *
   * This route had NO guard and NO throttle. Two problems with that, and the
   * second is the expensive one:
   *
   *  1. It is an unauthenticated PAN/GST lookup service on the public
   *     internet, which is a data-protection concern in its own right.
   *  2. Every call spends money. Anyone could point a script at it and run up
   *     the IDfy bill, or simply use Yukizi's account as a free lookup API.
   *
   * `JwtAuthGuard` only — deliberately NOT a role restriction. Sellers call
   * this during onboarding through `verifyGstOrPan` in the seller app, so
   * narrowing it to ADMIN would break seller signup. Requiring a valid login
   * is enough to stop anonymous abuse while leaving every real caller working.
   *
   * The throttle is per-IP and generous compared to a genuine onboarding
   * flow, where a seller verifies a GST and a PAN once each.
   */
  @Post('pangst')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @Throttle({ default: { limit: 10, ttl: 60000 } })
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Verify GST or PAN number via IDFY (authenticated)' })
  @ApiResponse({ status: 200, description: 'Verification result returned' })
  @ApiResponse({ status: 400, description: 'Validation error' })
  @ApiResponse({ status: 401, description: 'Authentication required' })
  async verifyGstPan(@Body() dto: VerifyGstPanDto): Promise<any> {
    if (!this.idfyService.isConfigured()) {
      throw new BadRequestException(
        'IDFY verification service is not configured',
      );
    }

    // The GST/PAN number and the provider's full response used to be written
    // to the logs in plain text. A PAN identifies a person, so that turned
    // every log sink into a store of personal identifiers. Log that a check
    // happened and of which kind; never log the number or the response body.
    this.logger.log(`GST/PAN verification requested (type: ${dto.type})`);

    if (dto.type === VerificationType.PAN) {
      return this.idfyService.verifyPan(dto.value);
    }
    return this.idfyService.verifyGst(dto.value);
  }
}
