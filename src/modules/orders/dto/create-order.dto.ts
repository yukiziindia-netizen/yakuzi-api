import { IsNotEmpty, IsString, Length, Matches } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class CreateOrderDto {
  @ApiProperty({ example: 'Rajesh Pharmacy' })
  @IsString()
  @IsNotEmpty({ message: 'Name is required' })
  name: string;

  @ApiProperty({ example: '7777777777' })
  @IsString()
  @IsNotEmpty({ message: 'Phone is required' })
  @Matches(/^[6-9]\d{9}$/, { message: 'Enter a valid 10-digit Indian phone number' })
  phone: string;

  @ApiProperty({ example: '123, MG Road, Andheri East' })
  @IsString()
  @IsNotEmpty({ message: 'Address is required' })
  address: string;

  @ApiProperty({ example: 'Mumbai' })
  @IsString()
  @IsNotEmpty({ message: 'City is required' })
  city: string;

  @ApiProperty({ example: 'Maharashtra' })
  @IsString()
  @IsNotEmpty({ message: 'State is required' })
  state: string;

  @ApiProperty({ example: '400069' })
  @IsString()
  @IsNotEmpty({ message: 'Pincode is required' })
  @Length(6, 6, { message: 'Pincode must be exactly 6 digits' })
  @Matches(/^\d{6}$/, { message: 'Pincode must be a 6-digit number' })
  pincode: string;
}
