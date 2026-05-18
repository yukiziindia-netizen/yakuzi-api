import { IsNotEmpty, IsString, IsOptional, IsUUID } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class CreateCustomOrderDto {
  @ApiProperty({ example: 'I need 500 units of this medicine for my pharmacy.' })
  @IsString()
  @IsNotEmpty()
  message: string;

  @ApiProperty({ example: 'uuid-of-product', required: false })
  @IsOptional()
  @IsUUID()
  productId?: string;
}
