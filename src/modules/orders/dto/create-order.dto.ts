import {
  IsBoolean,
  IsEmail,
  IsNotEmpty,
  IsOptional,
  IsString,
  Length,
  Matches,
} from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class CreateOrderDto {
  @ApiProperty({ example: 'Rajesh Pharmacy' })
  @IsString()
  @IsNotEmpty({ message: 'Name is required' })
  name: string;

  @ApiProperty({ example: '7777777777' })
  @IsString()
  @IsNotEmpty({ message: 'Phone is required' })
  @Matches(/^[6-9]\d{9}$/, {
    message: 'Enter a valid 10-digit Indian phone number',
  })
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

  @ApiProperty({ example: 'buyer@example.com', required: false })
  @IsOptional()
  @IsEmail({}, { message: 'Enter a valid email address' })
  email?: string;

  @ApiProperty({
    example: false,
    required: false,
    description:
      'Set when the buyer is about to pay online (Razorpay). Holds off ' +
      'notifying sellers and showing this order on their dashboard until ' +
      'the payment actually succeeds, instead of the moment the order ' +
      'record is created. Omit/false for COD, bank transfer or credit ' +
      'orders, which are correctly visible to sellers immediately.',
  })
  @IsOptional()
  @IsBoolean()
  deferSellerNotification?: boolean;
}
