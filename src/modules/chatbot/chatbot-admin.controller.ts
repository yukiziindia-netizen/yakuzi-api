import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Role, ChatbotTrainingTier } from '@prisma/client';
import { IsArray, ArrayNotEmpty, ArrayUnique, IsEnum, IsString } from 'class-validator';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { ChatbotService, CreateChatbotTrainingDto, UpdateChatbotTrainingDto } from './chatbot.service';

export class ReorderChatbotTrainingsDto {
  @IsEnum(ChatbotTrainingTier)
  tier: ChatbotTrainingTier;

  @IsArray()
  @ArrayNotEmpty()
  @ArrayUnique()
  @IsString({ each: true })
  orderedIds!: string[];
}

@ApiTags('Admin / Chatbot')
@ApiBearerAuth('JWT-auth')
@Controller('admin/chatbot')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(Role.ADMIN)
export class ChatbotAdminController {
  constructor(private readonly chatbotService: ChatbotService) {}

  @Get('trainings')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'List saved chatbot trainings, tier then order' })
  async listTrainings() {
    const data = await this.chatbotService.listTrainings();
    return { message: 'Trainings retrieved successfully', data };
  }

  @Post('trainings')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Save a sandbox conversation as a training example' })
  async createTraining(@Body() dto: CreateChatbotTrainingDto) {
    const data = await this.chatbotService.createTraining(dto);
    return { message: 'Training saved successfully', data };
  }

  @Patch('trainings/reorder')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Reorder trainings within a tier' })
  async reorderTrainings(@Body() dto: ReorderChatbotTrainingsDto) {
    const data = await this.chatbotService.reorderTrainings(dto.tier, dto.orderedIds);
    return { message: 'Trainings reordered successfully', data };
  }

  @Patch('trainings/:id')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: "Update a training's tier, order, or label" })
  async updateTraining(@Param('id') id: string, @Body() dto: UpdateChatbotTrainingDto) {
    const data = await this.chatbotService.updateTraining(id, dto);
    return { message: 'Training updated successfully', data };
  }

  @Delete('trainings/:id')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Delete one saved training' })
  async deleteTraining(@Param('id') id: string) {
    await this.chatbotService.deleteTraining(id);
    return { message: 'Training deleted successfully' };
  }

  @Delete('trainings')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Delete every saved training and reset the live prompt to default' })
  async deleteAllTrainings() {
    await this.chatbotService.deleteAllTrainings();
    return { message: 'All trainings cleared — chatbot reset to default.' };
  }
}
