import { Test } from '@nestjs/testing';
import { BadRequestException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ChatbotService } from './chatbot.service';
import { PrismaService } from '../../database/prisma.service';

describe('ChatbotService training', () => {
  let service: ChatbotService;
  let prisma: {
    chatbotJob: {
      findMany: jest.Mock;
      findUnique: jest.Mock;
      create: jest.Mock;
      update: jest.Mock;
      delete: jest.Mock;
      deleteMany: jest.Mock;
      aggregate: jest.Mock;
    };
    $transaction: jest.Mock;
  };

  beforeEach(async () => {
    prisma = {
      chatbotJob: {
        findMany: jest.fn(),
        findUnique: jest.fn(),
        create: jest.fn(),
        update: jest.fn(),
        delete: jest.fn(),
        deleteMany: jest.fn(),
        aggregate: jest.fn(),
      },
      $transaction: jest.fn(),
    };

    const moduleRef = await Test.createTestingModule({
      providers: [
        ChatbotService,
        { provide: ConfigService, useValue: { get: () => '' } },
        { provide: PrismaService, useValue: prisma },
      ],
    }).compile();

    service = moduleRef.get(ChatbotService);
    jest.spyOn(service, 'resyncSidecar').mockResolvedValue(undefined);
  });

  describe('createTraining', () => {
    it('rejects a history with no user/assistant pair', async () => {
      await expect(
        service.createTraining({ history: [{ role: 'user', content: 'hi' }] }),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(prisma.chatbotJob.create).not.toHaveBeenCalled();
    });

    it('derives a label from the first user message when none is given', async () => {
      prisma.chatbotJob.aggregate.mockResolvedValue({ _max: { order: 2 } });
      prisma.chatbotJob.create.mockResolvedValue({ id: 'job-1' });

      await service.createTraining({
        history: [
          { role: 'user', content: 'What is your return policy?' },
          { role: 'assistant', content: 'Thirty days, no questions asked.' },
        ],
      });

      expect(prisma.chatbotJob.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            label: 'What is your return policy?',
            tier: 'SURFACE',
            order: 3,
          }),
        }),
      );
    });
  });

  describe('reorderTrainings', () => {
    it('rejects an id set that does not exactly match the tier', async () => {
      prisma.chatbotJob.findMany.mockResolvedValue([{ id: 'a' }, { id: 'b' }]);

      await expect(service.reorderTrainings('CORE', ['a'])).rejects.toBeInstanceOf(
        BadRequestException,
      );
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it('writes sequential order values in the given order', async () => {
      prisma.chatbotJob.findMany
        .mockResolvedValueOnce([{ id: 'a' }, { id: 'b' }])
        .mockResolvedValueOnce([]);
      prisma.$transaction.mockResolvedValue(undefined);

      await service.reorderTrainings('CORE', ['b', 'a']);

      expect(prisma.$transaction).toHaveBeenCalledTimes(1);
      expect(prisma.chatbotJob.update).toHaveBeenCalledWith({ where: { id: 'b' }, data: { order: 0 } });
      expect(prisma.chatbotJob.update).toHaveBeenCalledWith({ where: { id: 'a' }, data: { order: 1 } });
    });
  });
});
