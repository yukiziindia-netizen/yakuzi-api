import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ChatbotController } from './chatbot.controller';
import { ChatbotService } from './chatbot.service';
import { ChatbotRulesController } from './chatbot-rules.controller';
import { ChatbotRulesService } from './chatbot-rules.service';
import { DatabaseModule } from '../../database/database.module';

@Module({
  imports: [ConfigModule, DatabaseModule],
  controllers: [ChatbotController, ChatbotRulesController],
  providers: [ChatbotService, ChatbotRulesService],
  exports: [ChatbotService],
})
export class ChatbotModule {}
