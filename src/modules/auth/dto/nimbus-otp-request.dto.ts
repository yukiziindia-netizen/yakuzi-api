import { ApiProperty } from '@nestjs/swagger';

export class NimbusAuthDto {
  @ApiProperty({ example: 't5jaipharma' })
  User: string;

  @ApiProperty({ example: '010Qftn20u6Y7M31aWNY' })
  Key: string;
}

export class NimbusDataDto {
  @ApiProperty({ example: 'PHABAG' })
  Sender: string;

  @ApiProperty({
    example: 'Welcome to Pharmabag. Use OTP {otp} to login to your Pharmabag account',
  })
  Message: string;

  @ApiProperty({ example: '0' })
  Flash: string;

  @ApiProperty({ example: '1564879' })
  ReferenceId: string;

  @ApiProperty({ example: '1701163558888608648' })
  EntityId: string;

  @ApiProperty({ example: '1707163835062147514' })
  TemplateId: string;

  @ApiProperty({ type: [String], example: ['9831864222'] })
  Mobile: string[];
}

export class NimbusOtpRequestDto {
  @ApiProperty({ type: NimbusAuthDto })
  Authorization: NimbusAuthDto;

  @ApiProperty({ type: NimbusDataDto })
  Data: NimbusDataDto;
}

export class NimbusOtpResponseDto {
  status?: string;
  message?: string;
  referenceId?: string;
  [key: string]: any;
}
