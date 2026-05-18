import { IsEnum, IsString, IsNotEmpty } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export enum NotificationTarget {
  ALL = 'ALL',
  BUYER = 'BUYER',
  SELLER = 'SELLER',
}

export class AdminBroadcastNotificationDto {
  @ApiProperty({ enum: NotificationTarget, example: NotificationTarget.ALL })
  @IsEnum(NotificationTarget)
  target: NotificationTarget;

  @ApiProperty({ example: 'Important updates regarding new features.' })
  @IsString()
  @IsNotEmpty()
  message: string;
}
