import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';
import { CreateChatbotRuleDto, UpdateChatbotRuleDto } from './chatbot-rules.dto';

@Injectable()
export class ChatbotRulesService {
  constructor(private readonly prisma: PrismaService) {}

  create(dto: CreateChatbotRuleDto) {
    return this.prisma.chatbotRule.create({
      data: { trigger: dto.trigger, instruction: dto.instruction },
    });
  }

  list() {
    return this.prisma.chatbotRule.findMany({ orderBy: { createdAt: 'desc' } });
  }

  async update(id: string, dto: UpdateChatbotRuleDto) {
    const existing = await this.prisma.chatbotRule.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException('Chatbot rule not found');

    return this.prisma.chatbotRule.update({
      where: { id },
      data: { trigger: dto.trigger, instruction: dto.instruction, isActive: dto.isActive },
    });
  }

  async delete(id: string) {
    const existing = await this.prisma.chatbotRule.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException('Chatbot rule not found');

    return this.prisma.chatbotRule.delete({ where: { id } });
  }
}
