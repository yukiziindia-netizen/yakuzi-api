import { IsNotEmpty, IsOptional, IsString, IsUUID, MaxLength } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CreateTicketDto {
  @ApiProperty({ example: 'Order not delivered', maxLength: 200 })
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  subject: string;

  @ApiProperty({
    example: 'My order #123 has not been delivered yet...',
    maxLength: 2000,
  })
  @IsString()
  @IsNotEmpty()
  @MaxLength(2000)
  message: string;

  @ApiPropertyOptional({
    description:
      'The order this is about, when raised from one. Optional — plenty of ' +
      'tickets are general. When given, it is what lets the sellers on that ' +
      'order be told a buyer has raised something about it.',
    example: '7f3c1a2b-0000-1111-2222-333344445555',
  })
  @IsOptional()
  @IsUUID()
  orderId?: string;
}
