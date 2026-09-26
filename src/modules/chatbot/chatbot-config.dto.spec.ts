import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { UpdateChatbotConfigDto } from './chatbot-config.dto';
import { CreateChatbotRuleDto } from './chatbot-rules.dto';

describe('UpdateChatbotConfigDto', () => {
  it('accepts the whole config row the Studio sends back', async () => {
    // The Studio reads the raw row and PATCHes the entire object on save
    // (and posts it to preview). With forbidNonWhitelisted on, the
    // undeclared bookkeeping columns made every save and preview a 400 —
    // the Studio could not change a single setting.
    const dto = plainToInstance(UpdateChatbotConfigDto, {
      assistantName: 'Yuki',
      id: 'chatbot-config',
      updatedAt: '2026-09-26T00:00:00.000Z',
      updatedBy: 'admin@yukizi.com',
    });
    const errors = await validate(dto, { whitelist: true, forbidNonWhitelisted: true });
    expect(errors).toHaveLength(0);
  });
});

describe('CreateChatbotRuleDto', () => {
  it('rejects rule text long enough to bloat every prompt', async () => {
    const dto = plainToInstance(CreateChatbotRuleDto, {
      trigger: 'x'.repeat(501),
      instruction: 'y'.repeat(2001),
    });
    const errors = await validate(dto);
    expect(JSON.stringify(errors)).toContain('maxLength');
  });
});
