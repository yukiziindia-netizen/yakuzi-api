import { IsEnum } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';
import { OrderStatus } from '@prisma/client';

export class UpdateOrderStatusDto {
  @ApiProperty({ enum: ['ACCEPTED', 'SHIPPED', 'OUT_FOR_DELIVERY', 'DELIVERED'], example: 'ACCEPTED' })
  @IsEnum(
    {
      ACCEPTED: OrderStatus.ACCEPTED,
      SHIPPED: OrderStatus.SHIPPED,
      OUT_FOR_DELIVERY: OrderStatus.OUT_FOR_DELIVERY,
      DELIVERED: OrderStatus.DELIVERED,
    },
    {
      message:
        'Status must be one of: ACCEPTED, SHIPPED, OUT_FOR_DELIVERY, DELIVERED',
    },
  )
  status: OrderStatus;
}
