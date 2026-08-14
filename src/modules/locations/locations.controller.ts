import { Controller, Get, HttpCode, HttpStatus } from '@nestjs/common';
import { ApiOperation, ApiResponse } from '@nestjs/swagger';
import { LocationsService } from './locations.service';

@Controller('locations')
export class LocationsController {
  constructor(private readonly locationsService: LocationsService) {}

  @Get('cities')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'List real seller cities for the buyer Filters panel' })
  @ApiResponse({ status: 200, description: 'City list returned' })
  async getCities() {
    const data = await this.locationsService.getCities();
    return { message: 'Cities retrieved successfully', data };
  }
}
