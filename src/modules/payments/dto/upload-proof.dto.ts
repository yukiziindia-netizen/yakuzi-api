import { IsNotEmpty, IsString, IsUrl } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class UploadProofDto {
  @ApiProperty({ example: 'payment-proofs/uuid.jpg', description: 'URL or S3 Key of the payment proof image' })
  @IsString()
  @IsNotEmpty({ message: 'proofUrl is required' })
  proofUrl: string;
}
