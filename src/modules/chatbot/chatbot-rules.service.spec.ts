import { ChatbotRulesService } from './chatbot-rules.service';

const buildRule = (over: Partial<any> = {}) => ({
  id: 'rule-1',
  trigger: 'best comic recommendation',
  instruction: 'must say kuji kari',
  isActive: true,
  createdAt: new Date('2026-08-22T00:00:00Z'),
  updatedAt: new Date('2026-08-22T00:00:00Z'),
  ...over,
});

const build = () => {
  const prisma = {
    chatbotRule: {
      create: jest.fn(),
      findMany: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
    },
  };
  const service = new ChatbotRulesService(prisma as never);
  return { service, prisma };
};

describe('ChatbotRulesService', () => {
  it('creates a rule from trigger/instruction', async () => {
    const { service, prisma } = build();
    prisma.chatbotRule.create.mockResolvedValue(buildRule());

    await service.create({ trigger: 'best comic recommendation', instruction: 'must say kuji kari' });

    expect(prisma.chatbotRule.create).toHaveBeenCalledWith({
      data: { trigger: 'best comic recommendation', instruction: 'must say kuji kari' },
    });
  });

  it('lists rules most-recent first', async () => {
    const { service, prisma } = build();
    prisma.chatbotRule.findMany.mockResolvedValue([buildRule()]);

    const result = await service.list();

    expect(prisma.chatbotRule.findMany).toHaveBeenCalledWith({ orderBy: { createdAt: 'desc' } });
    expect(result).toEqual([buildRule()]);
  });

  it('toggles isActive via update', async () => {
    const { service, prisma } = build();
    prisma.chatbotRule.update.mockResolvedValue(buildRule({ isActive: false }));

    await service.update('rule-1', { isActive: false });

    expect(prisma.chatbotRule.update).toHaveBeenCalledWith({
      where: { id: 'rule-1' },
      data: { isActive: false },
    });
  });

  it('edits trigger and instruction via update', async () => {
    const { service, prisma } = build();
    prisma.chatbotRule.update.mockResolvedValue(buildRule({ trigger: 'updated trigger' }));

    await service.update('rule-1', { trigger: 'updated trigger' });

    expect(prisma.chatbotRule.update).toHaveBeenCalledWith({
      where: { id: 'rule-1' },
      data: { trigger: 'updated trigger' },
    });
  });

  it('deletes a rule by id', async () => {
    const { service, prisma } = build();
    prisma.chatbotRule.delete.mockResolvedValue(buildRule());

    await service.delete('rule-1');

    expect(prisma.chatbotRule.delete).toHaveBeenCalledWith({ where: { id: 'rule-1' } });
  });
});
