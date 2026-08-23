import { BadRequestException, NotFoundException } from '@nestjs/common';
import { ChatbotRulesService } from './chatbot-rules.service';

const buildRule = (over: Partial<any> = {}) => ({
  id: 'rule-1',
  trigger: 'best comic recommendation',
  instruction: 'must say kuji kari',
  isActive: true,
  tier: 'SURFACE',
  order: 0,
  createdAt: new Date('2026-08-22T00:00:00Z'),
  updatedAt: new Date('2026-08-22T00:00:00Z'),
  ...over,
});

const build = () => {
  const prisma = {
    chatbotRule: {
      create: jest.fn(),
      findMany: jest.fn(),
      findUnique: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
      deleteMany: jest.fn(),
      aggregate: jest.fn(),
    },
    $transaction: jest.fn(),
  };
  const service = new ChatbotRulesService(prisma as never);
  return { service, prisma };
};

describe('ChatbotRulesService', () => {
  it('creates a rule at the end of its tier, defaulting to SURFACE', async () => {
    const { service, prisma } = build();
    prisma.chatbotRule.aggregate.mockResolvedValue({ _max: { order: 2 } });
    prisma.chatbotRule.create.mockResolvedValue(buildRule({ order: 3 }));

    await service.create({ trigger: 'best comic recommendation', instruction: 'must say kuji kari' });

    expect(prisma.chatbotRule.aggregate).toHaveBeenCalledWith({
      where: { tier: 'SURFACE' },
      _max: { order: true },
    });
    expect(prisma.chatbotRule.create).toHaveBeenCalledWith({
      data: {
        trigger: 'best comic recommendation',
        instruction: 'must say kuji kari',
        tier: 'SURFACE',
        order: 3,
      },
    });
  });

  it('creates a CORE rule in the CORE tier when asked', async () => {
    const { service, prisma } = build();
    prisma.chatbotRule.aggregate.mockResolvedValue({ _max: { order: null } });
    prisma.chatbotRule.create.mockResolvedValue(buildRule({ tier: 'CORE', order: 0 }));

    await service.create({ trigger: 't', instruction: 'i', tier: 'CORE' });

    expect(prisma.chatbotRule.create).toHaveBeenCalledWith({
      data: { trigger: 't', instruction: 'i', tier: 'CORE', order: 0 },
    });
  });

  it('stores the source conversation on create when provided', async () => {
    const { service, prisma } = build();
    prisma.chatbotRule.aggregate.mockResolvedValue({ _max: { order: null } });
    prisma.chatbotRule.create.mockResolvedValue(buildRule());
    const history = [
      { role: 'user', content: 'never discuss politics' },
      { role: 'assistant', content: 'Understood.' },
    ];

    await service.create({ trigger: 't', instruction: 'i', history });

    expect(prisma.chatbotRule.create).toHaveBeenCalledWith({
      data: { trigger: 't', instruction: 'i', tier: 'SURFACE', order: 0, history },
    });
  });

  it('overwrites the stored conversation on update when provided', async () => {
    const { service, prisma } = build();
    prisma.chatbotRule.findUnique.mockResolvedValue(buildRule());
    prisma.chatbotRule.update.mockResolvedValue(buildRule());
    const history = [{ role: 'user', content: 'refined teaching' }];

    await service.update('rule-1', { trigger: 't2', instruction: 'i2', history });

    expect(prisma.chatbotRule.update).toHaveBeenCalledWith({
      where: { id: 'rule-1' },
      data: {
        trigger: 't2',
        instruction: 'i2',
        isActive: undefined,
        tier: undefined,
        order: undefined,
        history,
      },
    });
  });

  it('lists rules CORE-first, then manual order, then creation time', async () => {
    const { service, prisma } = build();
    prisma.chatbotRule.findMany.mockResolvedValue([buildRule()]);

    const result = await service.list();

    expect(prisma.chatbotRule.findMany).toHaveBeenCalledWith({
      orderBy: [{ tier: 'asc' }, { order: 'asc' }, { createdAt: 'asc' }],
    });
    expect(result).toEqual([buildRule()]);
  });

  it('toggles isActive via update', async () => {
    const { service, prisma } = build();
    prisma.chatbotRule.findUnique.mockResolvedValue(buildRule());
    prisma.chatbotRule.update.mockResolvedValue(buildRule({ isActive: false }));

    await service.update('rule-1', { isActive: false });

    expect(prisma.chatbotRule.update).toHaveBeenCalledWith({
      where: { id: 'rule-1' },
      data: {
        trigger: undefined,
        instruction: undefined,
        isActive: false,
        tier: undefined,
        order: undefined,
      },
    });
  });

  it('appends to the end of the target tier on a tier move without explicit order', async () => {
    const { service, prisma } = build();
    prisma.chatbotRule.findUnique.mockResolvedValue(buildRule({ tier: 'SURFACE', order: 0 }));
    prisma.chatbotRule.aggregate.mockResolvedValue({ _max: { order: 4 } });
    prisma.chatbotRule.update.mockResolvedValue(buildRule({ tier: 'CORE', order: 5 }));

    await service.update('rule-1', { tier: 'CORE' });

    expect(prisma.chatbotRule.aggregate).toHaveBeenCalledWith({
      where: { tier: 'CORE' },
      _max: { order: true },
    });
    expect(prisma.chatbotRule.update).toHaveBeenCalledWith({
      where: { id: 'rule-1' },
      data: {
        trigger: undefined,
        instruction: undefined,
        isActive: undefined,
        tier: 'CORE',
        order: 5,
      },
    });
  });

  it('throws NotFoundException when updating a non-existent id', async () => {
    const { service, prisma } = build();
    prisma.chatbotRule.findUnique.mockResolvedValue(null);

    await expect(service.update('missing-id', { isActive: false })).rejects.toThrow(
      NotFoundException,
    );
    expect(prisma.chatbotRule.update).not.toHaveBeenCalled();
  });

  it('deletes a rule by id', async () => {
    const { service, prisma } = build();
    prisma.chatbotRule.findUnique.mockResolvedValue(buildRule());
    prisma.chatbotRule.delete.mockResolvedValue(buildRule());

    await service.delete('rule-1');

    expect(prisma.chatbotRule.delete).toHaveBeenCalledWith({ where: { id: 'rule-1' } });
  });

  it('throws NotFoundException when deleting a non-existent id', async () => {
    const { service, prisma } = build();
    prisma.chatbotRule.findUnique.mockResolvedValue(null);

    await expect(service.delete('missing-id')).rejects.toThrow(NotFoundException);
    expect(prisma.chatbotRule.delete).not.toHaveBeenCalled();
  });

  it('deleteAll clears every rule', async () => {
    const { service, prisma } = build();
    prisma.chatbotRule.deleteMany.mockResolvedValue({ count: 3 });

    await service.deleteAll();

    expect(prisma.chatbotRule.deleteMany).toHaveBeenCalledWith();
  });

  describe('reorder', () => {
    it('rejects an id set that does not exactly match the tier', async () => {
      const { service, prisma } = build();
      prisma.chatbotRule.findMany.mockResolvedValue([{ id: 'a' }, { id: 'b' }]);

      await expect(service.reorder('CORE', ['a'])).rejects.toThrow(BadRequestException);
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it('writes sequential order values in the given order', async () => {
      const { service, prisma } = build();
      prisma.chatbotRule.findMany
        .mockResolvedValueOnce([{ id: 'a' }, { id: 'b' }])
        .mockResolvedValueOnce([]);
      prisma.$transaction.mockResolvedValue(undefined);

      await service.reorder('CORE', ['b', 'a']);

      expect(prisma.$transaction).toHaveBeenCalledTimes(1);
      expect(prisma.chatbotRule.update).toHaveBeenCalledWith({ where: { id: 'b' }, data: { order: 0 } });
      expect(prisma.chatbotRule.update).toHaveBeenCalledWith({ where: { id: 'a' }, data: { order: 1 } });
    });
  });
});
