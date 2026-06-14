import { IsNotEmpty, IsString, MinLength } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class LoginPasswordDto {
  @ApiProperty({ example: 'user@example.com or 9831864222 or myuser', description: 'Email address, phone number, or username' })
  @IsString()
  @IsNotEmpty()
  contact: string;

  @ApiProperty({ example: 'SecureP@ssw0rd', description: 'User password' })
  @IsString()
  @IsNotEmpty()
  @MinLength(6)
  password: string;
}
