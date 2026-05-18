import { ApiProperty } from '@nestjs/swagger';
import { IsEnum, IsString, IsNotEmpty } from 'class-validator';

export enum VerificationType {
  GST = 'GST',
  PAN = 'PAN',
}

export class VerifyGstPanDto {
  @ApiProperty({ enum: VerificationType, example: 'GST' })
  @IsEnum(VerificationType)
  @IsNotEmpty()
  type: VerificationType;

  @ApiProperty({
    example: '29ABCDE1234F1Z5',
    description: 'GST number (15 chars) or PAN number (10 chars)',
  })
  @IsString()
  @IsNotEmpty()
  value: string;
}
