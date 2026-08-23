import {
  ArrayNotEmpty,
  ArrayUnique,
  IsArray,
  IsBoolean,
  IsEnum,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
} from 'class-validator';
import { ChatbotRuleTier } from '@prisma/client';

export class CreateChatbotRuleDto {
  @IsString()
  @IsNotEmpty()
  trigger!: string;

  @IsString()
  @IsNotEmpty()
  instruction!: string;

  @IsOptional()
  @IsEnum(ChatbotRuleTier)
  tier?: ChatbotRuleTier;
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

  @IsOptional()
  @IsEnum(ChatbotRuleTier)
  tier?: ChatbotRuleTier;

  @IsOptional()
  @IsInt()
  order?: number;
}

export class ReorderChatbotRulesDto {
  @IsEnum(ChatbotRuleTier)
  tier!: ChatbotRuleTier;

  @IsArray()
  @ArrayNotEmpty()
  @ArrayUnique()
  @IsString({ each: true })
  orderedIds!: string[];
}
