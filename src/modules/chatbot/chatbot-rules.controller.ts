import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import { Role } from '@prisma/client';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { ChatbotRulesService } from './chatbot-rules.service';
import { CreateChatbotRuleDto, UpdateChatbotRuleDto } from './chatbot-rules.dto';

@Controller('admin/chatbot/rules')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(Role.ADMIN)
export class ChatbotRulesController {
  constructor(private readonly rulesService: ChatbotRulesService) {}

  @Get()
  @HttpCode(HttpStatus.OK)
  async list() {
    const data = await this.rulesService.list();
    return { message: 'Chatbot rules retrieved successfully', data };
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  async create(@Body() dto: CreateChatbotRuleDto) {
    const data = await this.rulesService.create(dto);
    return { message: 'Chatbot rule created successfully', data };
  }

  @Patch(':id')
  @HttpCode(HttpStatus.OK)
  async update(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateChatbotRuleDto) {
    const data = await this.rulesService.update(id, dto);
    return { message: 'Chatbot rule updated successfully', data };
  }

  @Delete(':id')
  @HttpCode(HttpStatus.OK)
  async delete(@Param('id', ParseUUIDPipe) id: string) {
    await this.rulesService.delete(id);
    return { message: 'Chatbot rule deleted successfully' };
  }
}
