import { IsEnum } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';
import { OrderStatus } from '@prisma/client';

export class AdminUpdateOrderStatusDto {
  @ApiProperty({
    enum: OrderStatus,
    example: 'CANCELLED',
    description: 'Admin can set any order status',
  })
  @IsEnum(OrderStatus, {
    message: `Status must be one of: ${Object.values(OrderStatus).join(', ')}`,
  })
  status: OrderStatus;
}
