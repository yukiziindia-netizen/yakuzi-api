import { Controller, Get, Header } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { FeedsService } from './feeds.service';

@ApiTags('feeds')
@Controller('feeds')
export class FeedsController {
  constructor(private readonly feedsService: FeedsService) {}

  // Public by design: Google Merchant Center fetches this URL on a schedule.
  @Get('google-merchant.xml')
  @Header('Content-Type', 'application/xml; charset=utf-8')
  @Header('Cache-Control', 'public, max-age=600')
  @ApiOperation({ summary: 'Google Merchant Center product feed (public)' })
  async googleMerchant(): Promise<string> {
    return this.feedsService.googleMerchantFeed();
  }
}
