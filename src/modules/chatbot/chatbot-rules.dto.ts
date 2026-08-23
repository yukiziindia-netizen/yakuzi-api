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
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import { ChatbotRuleTier } from '@prisma/client';

export class ChatbotRuleHistoryMessageDto {
  @IsString()
  role!: string;

  @IsOptional()
  @IsString()
  content?: string;
}

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

  /** The sandbox conversation this rule was distilled from — stored so the
   * admin can reload it later, continue teaching, and resave the same rule. */
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ChatbotRuleHistoryMessageDto)
  history?: ChatbotRuleHistoryMessageDto[];
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

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ChatbotRuleHistoryMessageDto)
  history?: ChatbotRuleHistoryMessageDto[];
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
