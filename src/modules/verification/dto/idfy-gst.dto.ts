import { ApiProperty } from '@nestjs/swagger';

/**
 * IDFY GST verification raw API payload structures
 */

export class IdfyGstRequestPayload {
  task_id: string;
  group_id: string;
  data: { gstin: string };
}

export class IdfyGstSourceOutput {
  legal_name?: string;
  gstin?: string;
  nature_of_business_activity?: string;
  principal_place_of_business_fields?: {
    principal_place_of_business_address?: string;
  };
  [key: string]: any;
}

export class IdfyGstResult {
  source_output?: IdfyGstSourceOutput;
  [key: string]: any;
}

export class IdfyGstTaskResponse {
  status: 'completed' | 'failed' | 'pending';
  result?: IdfyGstResult;
  error?: any;
}

/**
 * Standardized GST verification response (app-level, matches legacy format)
 */
export class IdfyGstVerificationResponseDto {
  @ApiProperty({ example: true })
  status: boolean;

  @ApiProperty({ example: 'KUMAR MEDICAL STORE', required: false })
  legalName?: string;

  @ApiProperty({ example: '29ABCDE1234F1Z5', required: false })
  gstNumber?: string;

  @ApiProperty({ example: 'Retail Trade', required: false })
  natureOfBusinessActivity?: string;

  @ApiProperty({
    example: '123, MG Road, Bangalore, Karnataka - 560001',
    required: false,
  })
  address?: string;

  @ApiProperty({ example: 'GST Number is valid' })
  message: string;

  @ApiProperty({ example: 'ind_gst_certificate', required: false })
  verifiedDocumentType?: string | null;

  constructor(partial?: Partial<IdfyGstVerificationResponseDto>) {
    if (partial) {
      Object.assign(this, partial);
    }
  }
}
