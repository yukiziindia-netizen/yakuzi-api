import { IsEnum } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';
import { TicketStatus } from '@prisma/client';

export class AdminUpdateTicketStatusDto {
  @ApiProperty({
    enum: TicketStatus,
    example: 'RESOLVED',
    description: 'Update ticket status',
  })
  @IsEnum(TicketStatus, {
    message: `Status must be one of: ${Object.values(TicketStatus).join(', ')}`,
  })
  status: TicketStatus;
}
