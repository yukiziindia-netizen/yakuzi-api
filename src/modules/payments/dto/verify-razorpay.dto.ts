import { IsNotEmpty, IsString } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class VerifyRazorpayDto {
  @ApiProperty({ example: 'order_PabcXYZ123', description: 'Razorpay order id' })
  @IsString()
  @IsNotEmpty()
  razorpayOrderId: string;

  @ApiProperty({ example: 'pay_PabcXYZ123', description: 'Razorpay payment id' })
  @IsString()
  @IsNotEmpty()
  razorpayPaymentId: string;

  @ApiProperty({
    description:
      'HMAC SHA256 of "<razorpayOrderId>|<razorpayPaymentId>" signed with the key secret',
  })
  @IsString()
  @IsNotEmpty()
  razorpaySignature: string;
}
