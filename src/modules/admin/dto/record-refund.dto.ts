import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsNumber, IsOptional, IsString, MaxLength, Min } from 'class-validator';

/**
 * What an admin fills in when the money has actually gone back.
 *
 * This records a refund that happened elsewhere — in Razorpay's dashboard, or
 * at a bank. Nothing here moves money; it is the record, and what lets us tell
 * the buyer.
 */
export class RecordRefundDto {
  @ApiProperty({
    description: 'Amount refunded, in rupees. Defaults to the order total.',
    example: 2499,
    required: false,
  })
  @IsOptional()
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  amount?: number;

  @ApiPropertyOptional({
    description:
      'Payment-provider or bank reference, so the buyer can quote it to their own bank',
    example: 'rfnd_PqL2xAb9',
  })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  reference?: string;

  @ApiPropertyOptional({
    description: 'Anything the buyer should know. Shown to them in the email.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  notes?: string;
}
