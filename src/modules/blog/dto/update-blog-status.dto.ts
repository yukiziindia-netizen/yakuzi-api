import { IsEnum } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';
import { BlogStatus } from '@prisma/client';

export class UpdateBlogStatusDto {
  @ApiProperty({ enum: BlogStatus })
  @IsEnum(BlogStatus)
  status: BlogStatus;
}
