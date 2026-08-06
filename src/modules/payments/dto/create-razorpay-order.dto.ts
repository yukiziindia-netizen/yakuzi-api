import { IsNotEmpty, IsUUID } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class CreateRazorpayOrderDto {
  @ApiProperty({
    example: '3fa85f64-5717-4562-b3fc-2c963f66afa6',
    description:
      'The order being paid for. The amount is read from this order, never sent by the client.',
  })
  @IsUUID()
  @IsNotEmpty()
  orderId: string;
}
