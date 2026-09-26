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
  MaxLength,
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
  // Both fields are concatenated into the system instruction of every
  // customer message (up to 100 active rules). Unbounded, one pasted
  // document in a rule silently inflated every prompt from then on —
  // these caps match the scale of the config DTO's own limits.
  @IsString()
  @IsNotEmpty()
  @MaxLength(500)
  trigger!: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(2000)
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
  @MaxLength(500)
  trigger?: string;

  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(2000)
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
