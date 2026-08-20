import { IsEmail, IsOptional } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class AddToWaitlistDto {
  @ApiProperty({
    example: 'buyer@example.com',
    required: false,
    description:
      'Required if the account has no email on file yet (this project logs ' +
      'in by phone/OTP, so many buyers never have one). Saved onto the ' +
      "user's account so the eventual back-in-stock email has somewhere to " +
      'go; ignored if the account already has an email.',
  })
  @IsOptional()
  @IsEmail({}, { message: 'Enter a valid email address' })
  email?: string;
}
