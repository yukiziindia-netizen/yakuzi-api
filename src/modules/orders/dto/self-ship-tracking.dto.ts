import { IsOptional, IsString, IsUrl, MaxLength } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class SelfShipTrackingDto {
  @ApiProperty({
    description: 'Courier tracking page for this shipment (http/https only)',
  })
  @IsUrl(
    { protocols: ['http', 'https'], require_protocol: true },
    { message: 'trackingUrl must be a valid http:// or https:// URL' },
  )
  @MaxLength(2048)
  trackingUrl: string;

  @ApiPropertyOptional({ description: 'Courier company name' })
  @IsString()
  @IsOptional()
  @MaxLength(120)
  courierName?: string;
}
