import { IsUUID } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';
import { CreateProductDto } from '../../products/dto/create-product.dto';

export class AdminCreateProductDto extends CreateProductDto {
  @ApiProperty({
    example: 'uuid-of-seller-user',
    description: "The User.id of the seller this item is being created for (the seller dropdown's selected value)",
  })
  @IsUUID()
  sellerId: string;
}
