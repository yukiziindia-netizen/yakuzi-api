import { IsNotEmpty, IsString, Matches } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class SendOtpDto {
  @ApiProperty({ example: 'user@example.com or 9831864222', description: 'Email address or 10-digit Indian mobile number' })
  @IsString()
  @IsNotEmpty()
  contact: string;
}
