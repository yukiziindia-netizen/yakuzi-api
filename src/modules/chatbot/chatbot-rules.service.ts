import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { ChatbotRuleTier, Prisma } from '@prisma/client';
import { PrismaService } from '../../database/prisma.service';
import { CreateChatbotRuleDto, UpdateChatbotRuleDto } from './chatbot-rules.dto';

@Injectable()
export class ChatbotRulesService {
  constructor(private readonly prisma: PrismaService) {}

  async create(dto: CreateChatbotRuleDto) {
    const tier = dto.tier ?? ChatbotRuleTier.SURFACE;
    const maxOrder = await this.prisma.chatbotRule.aggregate({
      where: { tier },
      _max: { order: true },
    });
    return this.prisma.chatbotRule.create({
      data: {
        trigger: dto.trigger,
        instruction: dto.instruction,
        tier,
        order: (maxOrder._max.order ?? -1) + 1,
      },
    });
  }

  // CORE first, then SURFACE, manually ordered within each tier — the same
  // sequence the sidecar injects them into the system prompt.
  list() {
    return this.prisma.chatbotRule.findMany({
      orderBy: [{ tier: 'asc' }, { order: 'asc' }, { createdAt: 'asc' }],
    });
  }

  async update(id: string, dto: UpdateChatbotRuleDto) {
    const existing = await this.prisma.chatbotRule.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException('Chatbot rule not found');

    // A tier move without an explicit order lands at the END of the target
    // tier — otherwise the row keeps its old order number and slots into the
    // middle of the other tier's list.
    let order = dto.order;
    if (dto.tier !== undefined && dto.tier !== existing.tier && dto.order === undefined) {
      const maxOrder = await this.prisma.chatbotRule.aggregate({
        where: { tier: dto.tier },
        _max: { order: true },
      });
      order = (maxOrder._max.order ?? -1) + 1;
    }

    return this.prisma.chatbotRule.update({
      where: { id },
      data: {
        trigger: dto.trigger,
        instruction: dto.instruction,
        isActive: dto.isActive,
        tier: dto.tier,
        order,
      },
    });
  }

  async delete(id: string) {
    const existing = await this.prisma.chatbotRule.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException('Chatbot rule not found');

    return this.prisma.chatbotRule.delete({ where: { id } });
  }

  async deleteAll() {
    await this.prisma.chatbotRule.deleteMany();
  }

  async reorder(tier: ChatbotRuleTier, orderedIds: string[]) {
    const existing = await this.prisma.chatbotRule.findMany({
      where: { tier },
      select: { id: true },
    });
    const existingIds = existing.map((r) => r.id).sort();
    const givenIds = [...orderedIds].sort();
    const isValid =
      givenIds.length === existingIds.length && givenIds.every((id, i) => id === existingIds[i]);
    if (!isValid) {
      throw new BadRequestException(
        `orderedIds must contain exactly the current set of ${tier} rule ids, each exactly once`,
      );
    }

    try {
      await this.prisma.$transaction(
        orderedIds.map((id, index) =>
          this.prisma.chatbotRule.update({ where: { id }, data: { order: index } }),
        ),
      );
    } catch (error) {
      // A rule deleted by another admin between the validation read above and
      // this write hits P2025 — surface it as a clean 400, not a raw 500.
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2025') {
        throw new BadRequestException(
          'Rules changed since this reorder was requested — please retry',
        );
      }
      throw error;
    }

    return this.list();
  }
}
