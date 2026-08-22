import { IsBoolean, IsNotEmpty, IsOptional, IsString } from 'class-validator';

export class CreateChatbotRuleDto {
  @IsString()
  @IsNotEmpty()
  trigger!: string;

  @IsString()
  @IsNotEmpty()
  instruction!: string;
}

export class UpdateChatbotRuleDto {
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  trigger?: string;

  @IsOptional()
  @IsString()
  @IsNotEmpty()
  instruction?: string;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}
