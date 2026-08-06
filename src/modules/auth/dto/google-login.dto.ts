import { IsNotEmpty, IsString } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class GoogleLoginDto {
  @ApiProperty({
    example: 'eyJhbGciOiJSUzI1NiIsImtpZCI6...',
    description:
      'The ID token issued by Google Identity Services on the client. Not an OAuth access token.',
  })
  @IsString()
  @IsNotEmpty()
  idToken: string;
}
