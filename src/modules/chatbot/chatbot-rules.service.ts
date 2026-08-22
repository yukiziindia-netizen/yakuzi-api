import { Injectable } from '@nestjs/common';
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

  update(id: string, dto: UpdateChatbotRuleDto) {
    return this.prisma.chatbotRule.update({
      where: { id },
      data: dto,
    });
  }

  delete(id: string) {
    return this.prisma.chatbotRule.delete({ where: { id } });
  }
}
