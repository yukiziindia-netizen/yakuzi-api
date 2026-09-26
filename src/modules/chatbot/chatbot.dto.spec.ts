import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { ChatRequestDto } from './chatbot.controller';

describe('ChatRequestDto', () => {
  it('accepts a history message that carries product cards', async () => {
    // The widget replays its transcript as history, and assistant messages
    // now carry the product cards they rendered. With forbidNonWhitelisted
    // on, an undeclared field turned every conversation that ever showed a
    // card into a 400 on the customer's NEXT message.
    const dto = plainToInstance(ChatRequestDto, {
      message: 'and under 1000?',
      history: [
        {
          role: 'assistant',
          content: 'Here are some items under ₹2000',
          products: [{ name: 'Maayan Issue 1', url: '/products/maayan-issue-1', price: 250 }],
        },
      ],
    });
    const errors = await validate(dto, { whitelist: true, forbidNonWhitelisted: true });
    expect(JSON.stringify(errors)).not.toContain('products');
    expect(errors).toHaveLength(0);
  });
});
