import {
  Controller,
  Post,
  Get,
  Delete,
  Body,
  Param,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse } from '@nestjs/swagger';
import { ChatbotService } from './chatbot.service';
import { PrismaService } from '../../database/prisma.service';
import {
  IsString,
  IsNotEmpty,
  IsArray,
  IsOptional,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import axios from 'axios';

export class AttachmentDto {
  @IsString()
  @IsNotEmpty()
  name: string;

  @IsString()
  @IsNotEmpty()
  data: string;

  @IsString()
  @IsNotEmpty()
  type: string;
}

export class ChatMessageDto {
  @IsString()
  @IsNotEmpty()
  role: string;

  @IsString()
  @IsOptional()
  content?: string;

  @IsArray()
  @IsOptional()
  @ValidateNested({ each: true })
  @Type(() => AttachmentDto)
  attachments?: AttachmentDto[];
}

export class ChatRequestDto {
  @IsString()
  @IsOptional()
  message?: string;

  @IsArray()
  @IsOptional()
  @ValidateNested({ each: true })
  @Type(() => ChatMessageDto)
  history?: ChatMessageDto[];

  @IsArray()
  @IsOptional()
  @ValidateNested({ each: true })
  @Type(() => AttachmentDto)
  attachments?: AttachmentDto[];
}

@ApiTags('Chatbot')
@Controller('chatbot')
export class ChatbotController {
  constructor(
    private readonly chatbotService: ChatbotService,
    private readonly prisma: PrismaService,
  ) {}

  @Post('job-status')
  async saveJobStatus(
    @Body() body: { jobId: string; status: string; history?: any[] },
  ) {
    // Save to SystemSetting (for latest)
    await this.prisma.systemSetting.upsert({
      where: { key: 'chatbot_job_id' },
      update: { value: body.jobId },
      create: { key: 'chatbot_job_id', value: body.jobId },
    });
    await this.prisma.systemSetting.upsert({
      where: { key: 'chatbot_job_status' },
      update: { value: body.status },
      create: { key: 'chatbot_job_status', value: body.status },
    });

    // Also insert into history if it doesn't exist, or update if it does
    const existingJob = await this.prisma.chatbotJob.findFirst({
      where: { jobId: body.jobId },
    });

    if (existingJob) {
      await this.prisma.chatbotJob.update({
        where: { id: existingJob.id },
        data: {
          status: body.status,
          ...(body.history && { history: body.history }),
        },
      });
    } else {
      await this.prisma.chatbotJob.create({
        data: {
          jobId: body.jobId,
          status: body.status,
          ...(body.history && { history: body.history }),
        },
      });
    }

    return { success: true };
  }

  @Get('job-status')
  async getJobStatus() {
    const jobId = await this.prisma.systemSetting.findUnique({
      where: { key: 'chatbot_job_id' },
    });
    const status = await this.prisma.systemSetting.findUnique({
      where: { key: 'chatbot_job_status' },
    });
    return {
      jobId: jobId?.value || '',
      status: status?.value || null,
    };
  }

  @Get('job-history')
  async getJobHistory() {
    const jobs = await this.prisma.chatbotJob.findMany({
      orderBy: { createdAt: 'desc' },
    });
    return jobs;
  }

  @Delete('job-history/:id')
  async deleteJob(@Param('id') id: string) {
    await this.prisma.chatbotJob.delete({
      where: { id },
    });
    return { success: true };
  }

  @Post('chat')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Send message to AI chatbot' })
  @ApiResponse({ status: 200, description: 'AI response returned' })
  async chat(@Body() dto: ChatRequestDto) {
    const response = await this.chatbotService.sendMessage(
      dto.message || '',
      dto.history || [],
      dto.attachments || [],
    );
    return { response };
  }

  @Post('train/conversation')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Train AI chatbot on a conversation' })
  async trainConversation(@Body() dto: any) {
    try {
      // Proxy the request to the Python sidecar
      const apiUrl = process.env.CHATBOT_API_URL || 'http://127.0.0.1:5005';
      const response = await axios.post(`${apiUrl}/train/conversation`, dto);
      return response.data;
    } catch (error: any) {
      if (error.response) {
        throw new Error(
          `Python sidecar error: ${JSON.stringify(error.response.data)}`,
        );
      }
      throw new Error(
        `Failed to communicate with Python sidecar: ${error.message}`,
      );
    }
  }
}
