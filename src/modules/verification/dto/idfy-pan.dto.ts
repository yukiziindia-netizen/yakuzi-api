import { ApiProperty } from '@nestjs/swagger';

/**
 * IDFY PAN verification raw API payload structures
 */

export class IdfyPanRequestPayload {
  task_id: string;
  group_id: string;
  data: { id_number: string };
}

export class IdfyPanSourceOutput {
  name_on_card?: string;
  [key: string]: any;
}

export class IdfyPanResult {
  source_output?: IdfyPanSourceOutput;
  [key: string]: any;
}

export class IdfyPanTaskResponse {
  status: 'completed' | 'failed' | 'pending';
  result?: IdfyPanResult;
  error?: any;
}

/**
 * Standardized PAN verification response (app-level, matches legacy format)
 */
export class IdfyVerificationResponseDto {
  @ApiProperty({ example: true })
  status: boolean;

  @ApiProperty({ example: 'RAJESH KUMAR', required: false })
  legalName?: string;

  @ApiProperty({ example: 'ABCDE1234F', required: false })
  gstNumber?: string;

  @ApiProperty({ example: 'Pan Number is valid' })
  message: string;

  @ApiProperty({ example: 'ind_pan', required: false })
  verifiedDocumentType?: string | null;

  constructor(partial?: Partial<IdfyVerificationResponseDto>) {
    if (partial) {
      Object.assign(this, partial);
    }
  }
}
