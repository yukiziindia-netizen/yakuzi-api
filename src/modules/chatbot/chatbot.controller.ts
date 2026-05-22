import { Controller, Post, Body, HttpCode, HttpStatus } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse } from '@nestjs/swagger';
import { ChatbotService } from './chatbot.service';
import { IsString, IsNotEmpty, IsArray, IsOptional } from 'class-validator';

export class ChatRequestDto {
  @IsString()
  @IsNotEmpty()
  message: string;

  @IsArray()
  @IsOptional()
  history?: Array<{ role: string; content: string }>;
}

@ApiTags('Chatbot')
@Controller('chatbot')
export class ChatbotController {
  constructor(private readonly chatbotService: ChatbotService) {}

  @Post('chat')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Send message to AI chatbot' })
  @ApiResponse({ status: 200, description: 'AI response returned' })
  async chat(@Body() dto: ChatRequestDto) {
    const response = await this.chatbotService.sendMessage(dto.message, dto.history || []);
    return { response };
  }
}
