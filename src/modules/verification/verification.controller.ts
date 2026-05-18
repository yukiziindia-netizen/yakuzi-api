import {
  Controller,
  Post,
  Body,
  HttpCode,
  HttpStatus,
  BadRequestException,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse } from '@nestjs/swagger';
import { IdfyService } from './idfy.service';
import { VerifyGstPanDto, VerificationType } from './dto/verify-gst-pan.dto';
import { IdfyVerificationResponseDto } from './dto/idfy-pan.dto';
import { IdfyGstVerificationResponseDto } from './dto/idfy-gst.dto';

@ApiTags('Verification')
@Controller('verification')
export class VerificationController {
  constructor(private readonly idfyService: IdfyService) {}

  @Post('pangst')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Verify GST or PAN number via IDFY' })
  @ApiResponse({ status: 200, description: 'Verification result returned' })
  @ApiResponse({ status: 400, description: 'Validation error' })
  async verifyGstPan(
    @Body() dto: VerifyGstPanDto,
  ): Promise<any> {
    if (!this.idfyService.isConfigured()) {
      throw new BadRequestException(
        'IDFY verification service is not configured',
      );
    }

    console.log(`[Verification] Received request - Type: ${dto.type}, Value: ${dto.value}`);

    let response;
    if (dto.type === VerificationType.PAN) {
      response = await this.idfyService.verifyPan(dto.value);
    } else {
      response = await this.idfyService.verifyGst(dto.value);
    }

    console.log(`[Verification] Response:`, JSON.stringify(response));
    return response;
  }
}
