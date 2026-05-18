import { IsString, IsNotEmpty, IsInt, Min } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class AddToCartDto {
  @ApiProperty({ example: 'uuid-of-product', description: 'Product UUID' })
  @IsString()
  @IsNotEmpty()
  productId: string;

  @ApiProperty({ example: 10, description: 'Quantity to add', minimum: 1 })
  @IsInt()
  @Min(1, { message: 'Quantity must be at least 1' })
  quantity: number;
}
