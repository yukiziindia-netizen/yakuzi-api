import { IsBoolean } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class UpdateSelfShipDto {
  @ApiProperty({
    description:
      'Whether new orders for this seller use self-ship fulfillment. Only affects orders created after the change.',
  })
  @IsBoolean()
  selfShipEnabled: boolean;
}
