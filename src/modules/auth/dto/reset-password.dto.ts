import { IsNotEmpty, IsString, MinLength } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class ResetPasswordDto {
  @ApiProperty({ example: 'user@example.com or 9831864222', description: 'Email address or phone number' })
  @IsString()
  @IsNotEmpty()
  contact: string;

  @ApiProperty({ example: '123456', description: '6-digit OTP' })
  @IsString()
  @IsNotEmpty()
  otp: string;

  @ApiProperty({ example: 'NewSecureP@ssw0rd', description: 'New password' })
  @IsString()
  @IsNotEmpty()
  @MinLength(6)
  newPassword: string;
}
