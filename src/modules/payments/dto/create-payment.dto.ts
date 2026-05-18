import {
  IsEnum,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsPositive,
  IsString,
  IsUUID,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { PaymentMethod } from '@prisma/client';

export class CreatePaymentDto {
  @ApiProperty({ example: 'uuid-of-order', description: 'Order UUID' })
  @IsUUID('4', { message: 'orderId must be a valid UUID' })
  @IsNotEmpty({ message: 'orderId is required' })
  orderId: string;

  @ApiProperty({ example: 1500.50, description: 'Payment amount' })
  @IsNumber({}, { message: 'amount must be a number' })
  @IsPositive({ message: 'amount must be a positive number' })
  @IsNotEmpty({ message: 'amount is required' })
  amount: number;

  @ApiProperty({ enum: ['BANK_TRANSFER', 'UPI', 'CASH_ON_DELIVERY', 'CHEQUE'], example: 'UPI' })
  @IsEnum(PaymentMethod, {
    message: `method must be one of: ${Object.values(PaymentMethod).join(', ')}`,
  })
  @IsNotEmpty({ message: 'method is required' })
  method: PaymentMethod;

  @ApiPropertyOptional({ example: 'UPI-REF-789012', description: 'Bank/UPI reference number' })
  @IsString()
  @IsOptional()
  referenceNumber?: string;
}
