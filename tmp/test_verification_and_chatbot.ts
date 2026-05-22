import { NestFactory } from '@nestjs/core';
import { AppModule } from '../src/app.module';
import { IdfyService } from '../src/modules/verification/idfy.service';
import { ChatbotService } from '../src/modules/chatbot/chatbot.service';

async function bootstrap() {
  console.log('Bootstrapping NestJS application context...');
  const app = await NestFactory.createApplicationContext(AppModule);
  
  const idfyService = app.get(IdfyService);
  const chatbotService = app.get(ChatbotService);

  console.log('Testing IdfyService (GST Verification)...');
  const gstResult = await idfyService.verifyGst('27AABCU9603R1ZM');
  console.log('GST Result:', JSON.stringify(gstResult, null, 2));

  // Aadhaar OTP APIs have been removed. We now accept Aadhaar directly without verification.

  console.log('\nTesting ChatbotService (simulated/real model)...');
  const chatResponse = await chatbotService.sendMessage('Hello! Who are you?', []);
  console.log('Chatbot Response:', chatResponse);

  console.log('Closing NestJS context...');
  await app.close();
}

bootstrap().catch(console.error);
