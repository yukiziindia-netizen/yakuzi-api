import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ChatbotController } from './chatbot.controller';
import { ChatbotService } from './chatbot.service';
import { DatabaseModule } from '../../database/database.module';

@Module({
  imports: [ConfigModule, DatabaseModule],
  controllers: [ChatbotController],
  providers: [ChatbotService],
  exports: [ChatbotService],
})
export class ChatbotModule {}
