import { IsNotEmpty, IsOptional, IsString, Length, Matches, IsDateString, IsEnum } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class RegisterBuyerDto {
  @ApiProperty({ example: 'johndoe', description: 'Username' })
  @IsString()
  @IsOptional()
  username?: string;

  @ApiProperty({ example: 'user@example.com or 9831864222', description: 'Email address or 10-digit Indian mobile number' })
  @IsString()
  @IsNotEmpty()
  contact: string;

  @ApiProperty({ example: '123456', description: '6-digit OTP' })
  @IsString()
  @IsNotEmpty()
  @Length(6, 6, { message: 'OTP must be exactly 6 digits' })
  @Matches(/^\d{6}$/, { message: 'OTP must contain only digits' })
  otp: string;

  @ApiProperty({ example: 'John Doe', description: 'Real name of the buyer' })
  @IsString()
  @IsNotEmpty()
  realName: string;

  @ApiProperty({ example: 'securePassword123', description: 'Password' })
  @IsString()
  @IsNotEmpty()
  password: string;

  @ApiProperty({ example: '1990-01-01', description: 'Date of birth' })
  @IsDateString()
  @IsOptional()
  dob?: string;

  @ApiProperty({ example: 'him', description: 'Gender' })
  @IsString()
  @IsOptional()
  gender?: string;
}
