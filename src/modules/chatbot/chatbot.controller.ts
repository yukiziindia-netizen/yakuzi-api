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
  IsBoolean,
  IsNumber,
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

  @IsString()
  @IsOptional()
  thoughts?: string;

  @IsNumber()
  @IsOptional()
  thinkingTimeMs?: number;

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

  @IsBoolean()
  @IsOptional()
  thinkingEnabled?: boolean;

  @IsNumber()
  @IsOptional()
  thinkingBudget?: number;
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
    try {
      if ((this.prisma as any).systemSetting) {
        await (this.prisma as any).systemSetting.upsert({
          where: { key: 'chatbot_job_id' },
          update: { value: body.jobId },
          create: { key: 'chatbot_job_id', value: body.jobId },
        });
        await (this.prisma as any).systemSetting.upsert({
          where: { key: 'chatbot_job_status' },
          update: { value: body.status },
          create: { key: 'chatbot_job_status', value: body.status },
        });
      }

      if ((this.prisma as any).chatbotJob) {
        const existingJob = await (this.prisma as any).chatbotJob.findFirst({
          where: { jobId: body.jobId },
        });

        if (existingJob) {
          await (this.prisma as any).chatbotJob.update({
            where: { id: existingJob.id },
            data: {
              status: body.status,
              ...(body.history && { history: body.history }),
            },
          });
        } else {
          await (this.prisma as any).chatbotJob.create({
            data: {
              jobId: body.jobId,
              status: body.status,
              ...(body.history && { history: body.history }),
            },
          });
        }
      }
    } catch (error) {
      // Ignore fallback errors
    }

    return { success: true };
  }

  @Get('job-status')
  async getJobStatus() {
    try {
      if ((this.prisma as any).systemSetting) {
        const jobId = await (this.prisma as any).systemSetting.findUnique({
          where: { key: 'chatbot_job_id' },
        });
        const status = await (this.prisma as any).systemSetting.findUnique({
          where: { key: 'chatbot_job_status' },
        });
        return {
          jobId: jobId?.value || '',
          status: status?.value || null,
        };
      }
    } catch (error) {
      // Ignore fallback errors
    }
    return { jobId: '', status: null };
  }

  private getSidecarUrl(): string {
    return process.env.CHATBOT_API_URL || 'http://127.0.0.1:5005';
  }

  private async resetSidecarMemory() {
    try {
      await axios.post(`${this.getSidecarUrl()}/train/reset`, {}, { timeout: 3000 });
    } catch (error) {
      // Ignore sidecar unreachable error gracefully
    }
  }

  private async syncSidecarMemory(histories: any[]) {
    try {
      await axios.post(`${this.getSidecarUrl()}/train/sync`, { histories }, { timeout: 3000 });
    } catch (error) {
      // Ignore sidecar unreachable error gracefully
    }
  }

  @Get('job-history')
  async getJobHistory() {
    try {
      if ((this.prisma as any).chatbotJob) {
        const jobs = await (this.prisma as any).chatbotJob.findMany({
          orderBy: { createdAt: 'desc' },
        });
        if (!jobs || jobs.length === 0) {
          await this.resetSidecarMemory();
        }
        return jobs || [];
      }
    } catch (error) {
      // Ignore fallback errors
    }
    await this.resetSidecarMemory();
    return [];
  }

  @Delete('job-history/:id')
  async deleteJob(@Param('id') id: string) {
    try {
      await (this.prisma as any).chatbotJob.delete({
        where: { id },
      });
      const remainingJobs = await (this.prisma as any).chatbotJob.findMany();
      if (!remainingJobs || remainingJobs.length === 0) {
        await this.resetSidecarMemory();
      } else {
        const validHistories = remainingJobs
          .map((j: any) => j.history)
          .filter((h: any) => Array.isArray(h) && h.length > 0);
        await this.syncSidecarMemory(validHistories);
      }
    } catch (error) {
      // Ignore error if job doesn't exist
    }
    return { success: true };
  }

  @Delete('job-history')
  async clearJobHistory() {
    try {
      if ((this.prisma as any).chatbotJob) {
        await (this.prisma as any).chatbotJob.deleteMany();
      }
    } catch (error) {
      // Ignore fallback error
    }
    await this.resetSidecarMemory();
    return { success: true };
  }

  @Post('train/reset')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Reset AI chatbot training memory to default' })
  async resetTraining() {
    try {
      const response = await axios.post(`${this.getSidecarUrl()}/train/reset`);
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

  @Post('chat')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Send message to AI chatbot' })
  @ApiResponse({ status: 200, description: 'AI response returned' })
  async chat(@Body() dto: ChatRequestDto) {
    const result = await this.chatbotService.sendMessage(
      dto.message || '',
      dto.history || [],
      dto.attachments || [],
      {
        thinkingEnabled: dto.thinkingEnabled,
        thinkingBudget: dto.thinkingBudget,
      },
    );
    return result;
  }

  @Post('train/conversation')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Train AI chatbot on a conversation' })
  async trainConversation(@Body() dto: any) {
    try {
      // Proxy the request to the Python sidecar
      const response = await axios.post(`${this.getSidecarUrl()}/train/conversation`, dto);
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
