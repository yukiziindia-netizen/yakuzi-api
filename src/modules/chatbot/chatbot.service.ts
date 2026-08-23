import {
  Injectable,
  Logger,
  OnModuleInit,
  OnModuleDestroy,
  BadRequestException,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { exec, spawn, ChildProcess } from 'child_process';
import * as path from 'path';
import * as fs from 'fs';
import axios from 'axios';
import { IsArray, IsEnum, IsInt, IsOptional, IsString, MaxLength, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';
import { ChatbotTrainingTier, Prisma } from '@prisma/client';

import { PrismaService } from '../../database/prisma.service';

export class ChatbotTrainingMessageDto {
  @IsString()
  role: string;

  @IsOptional()
  @IsString()
  content?: string;
}

export class CreateChatbotTrainingDto {
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ChatbotTrainingMessageDto)
  history: ChatbotTrainingMessageDto[];

  @IsOptional()
  @IsEnum(ChatbotTrainingTier)
  tier?: ChatbotTrainingTier;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  label?: string;
}

export class UpdateChatbotTrainingDto {
  @IsOptional()
  @IsEnum(ChatbotTrainingTier)
  tier?: ChatbotTrainingTier;

  @IsOptional()
  @IsInt()
  order?: number;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  label?: string;
}

@Injectable()
export class ChatbotService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(ChatbotService.name);
  private pythonProcess: ChildProcess | null = null;
  private readonly chatbotDir: string;
  private readonly port = 5005;

  constructor(
    private readonly configService: ConfigService,
    private readonly prisma: PrismaService,
  ) {
    this.chatbotDir = path.resolve(process.cwd(), 'chatbot');
  }

  async onModuleInit() {
    // Never let sidecar problems stop the API from booting.
    try {
      const venvPresent = fs.existsSync(this.pythonExecutable());
      const portResponding = await this.isSidecarResponding();

      if (venvPresent && portResponding) {
        this.logger.log('Python Chatbot Sidecar is already active and healthy.');
        await this.syncTrainingFromDatabase();
        return;
      }

      if (!venvPresent && portResponding) {
        // A sidecar whose virtualenv has been deleted underneath it keeps holding
        // the port and answering this check, while failing every real request.
        // The old port-only probe treated that as "healthy" and never rebuilt it.
        this.logger.warn(
          'Chatbot sidecar is running without its virtualenv (stale process). Retiring it and rebuilding...',
        );
        await this.killOrphanSidecar();
      } else if (!portResponding) {
        this.logger.log(
          `Python Chatbot Sidecar not detected on port ${this.port}. Attempting auto-launch...`,
        );
      }

      const pythonCmd = await this.resolvePythonCommand();
      if (!pythonCmd) {
        this.logger.warn('Python is not installed on server host. Chatbot sidecar will remain disabled.');
        return;
      }

      await this.setupVirtualEnv(pythonCmd);
      this.startPythonApp();

      // Wait briefly for sidecar to boot then sync database training jobs
      setTimeout(async () => {
        const active = await this.isSidecarResponding();
        if (active) {
          await this.syncTrainingFromDatabase();
        }
      }, 3000);
    } catch (setupErr) {
      this.logger.error(
        `Failed to launch Python chatbot sidecar: ${setupErr instanceof Error ? setupErr.message : 'Unknown error'}`,
      );
    }
  }

  async syncTrainingFromDatabase(): Promise<void> {
    try {
      if ((this.prisma as any).chatbotJob) {
        const jobs = await (this.prisma as any).chatbotJob.findMany();
        if (jobs && jobs.length > 0) {
          const validHistories = jobs
            .map((j: any) => j.history)
            .filter((h: any) => Array.isArray(h) && h.length > 0);

          if (validHistories.length > 0) {
            const apiUrl =
              process.env.CHATBOT_API_URL || `http://127.0.0.1:${this.port}`;
            await axios.post(
              `${apiUrl}/train/sync`,
              { histories: validHistories },
              { timeout: 5000 },
            );
            this.logger.log(
              `Synced ${validHistories.length} database training job(s) into Python Chatbot sidecar.`,
            );
            return;
          }
        }
      }
    } catch (err) {
      this.logger.warn(
        `Could not sync database training memory to sidecar: ${
          err instanceof Error ? err.message : 'Unknown error'
        }`,
      );
    }
  }

  // status:'SAVED' scoping everywhere below: chatbot_jobs is still shared with
  // the legacy, unauthenticated /chatbot/job-status routes, so rows written by
  // that old flow must never surface in the admin panel or the live prompt.
  async listTrainings() {
    return this.prisma.chatbotJob.findMany({
      where: { status: 'SAVED' },
      orderBy: [{ tier: 'asc' }, { order: 'asc' }, { createdAt: 'asc' }],
    });
  }

  async createTraining(dto: CreateChatbotTrainingDto) {
    const hasValidPair = dto.history.some(
      (m, i) =>
        m.role === 'user' &&
        !!m.content &&
        dto.history[i + 1] &&
        ['assistant', 'model'].includes(dto.history[i + 1].role) &&
        !!dto.history[i + 1].content,
    );
    if (!hasValidPair) {
      throw new BadRequestException(
        'No valid user-assistant exchange found in this conversation.',
      );
    }

    const tier = dto.tier ?? ChatbotTrainingTier.SURFACE;
    const maxOrder = await this.prisma.chatbotJob.aggregate({
      where: { tier, status: 'SAVED' },
      _max: { order: true },
    });
    const firstUserMessage = dto.history.find((m) => m.role === 'user' && m.content)?.content ?? 'Untitled training';

    const created = await this.prisma.chatbotJob.create({
      data: {
        jobId: `training_${Date.now()}`,
        status: 'SAVED',
        history: dto.history as unknown as Prisma.InputJsonValue,
        label: dto.label?.trim() || firstUserMessage.slice(0, 120),
        tier,
        order: (maxOrder._max.order ?? -1) + 1,
      },
    });

    await this.resyncSidecar();
    return created;
  }

  async updateTraining(id: string, dto: UpdateChatbotTrainingDto) {
    const existing = await this.prisma.chatbotJob.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException('Training not found');

    // A tier move without an explicit order lands at the END of the target
    // tier — otherwise the row keeps its old order number and slots into the
    // middle of the other tier's list.
    let order = dto.order;
    if (dto.tier !== undefined && dto.tier !== existing.tier && dto.order === undefined) {
      const maxOrder = await this.prisma.chatbotJob.aggregate({
        where: { tier: dto.tier, status: 'SAVED' },
        _max: { order: true },
      });
      order = (maxOrder._max.order ?? -1) + 1;
    }

    const updated = await this.prisma.chatbotJob.update({
      where: { id },
      data: {
        ...(dto.tier !== undefined && { tier: dto.tier }),
        ...(order !== undefined && { order }),
        ...(dto.label !== undefined && { label: dto.label.trim() }),
      },
    });

    await this.resyncSidecar();
    return updated;
  }

  async deleteTraining(id: string) {
    const existing = await this.prisma.chatbotJob.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException('Training not found');

    await this.prisma.chatbotJob.delete({ where: { id } });
    await this.resyncSidecar();
  }

  async deleteAllTrainings() {
    await this.prisma.chatbotJob.deleteMany();
    await this.resetSidecarPrompt();
  }

  async reorderTrainings(tier: ChatbotTrainingTier, orderedIds: string[]) {
    const existing = await this.prisma.chatbotJob.findMany({
      where: { tier, status: 'SAVED' },
      select: { id: true },
    });
    const existingIds = existing.map((j) => j.id).sort();
    const givenIds = [...orderedIds].sort();
    const isValid =
      givenIds.length === existingIds.length && givenIds.every((id, i) => id === existingIds[i]);
    if (!isValid) {
      throw new BadRequestException(
        `orderedIds must contain exactly the current set of ${tier} training ids, each exactly once`,
      );
    }

    try {
      await this.prisma.$transaction(
        orderedIds.map((id, index) =>
          this.prisma.chatbotJob.update({ where: { id }, data: { order: index } }),
        ),
      );
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2025') {
        throw new BadRequestException(
          'Trainings changed since this reorder was requested — please retry',
        );
      }
      throw error;
    }

    return this.listTrainings();
  }

  async resyncSidecar(): Promise<void> {
    const trainings = await this.prisma.chatbotJob.findMany({
      where: { status: 'SAVED' },
      orderBy: [{ tier: 'asc' }, { order: 'asc' }, { createdAt: 'asc' }],
    });
    const histories = trainings
      .map((t) => t.history)
      .filter((h): h is any[] => Array.isArray(h) && h.length > 0);

    try {
      const apiUrl = process.env.CHATBOT_API_URL || `http://127.0.0.1:${this.port}`;
      await axios.post(`${apiUrl}/train/sync`, { histories }, { timeout: 5000 });
    } catch (err) {
      this.logger.warn(
        `Could not resync training memory to sidecar: ${err instanceof Error ? err.message : 'Unknown error'}`,
      );
    }
  }

  private async resetSidecarPrompt(): Promise<void> {
    try {
      const apiUrl = process.env.CHATBOT_API_URL || `http://127.0.0.1:${this.port}`;
      await axios.post(`${apiUrl}/train/reset`, {}, { timeout: 5000 });
    } catch (err) {
      this.logger.warn(
        `Could not reset sidecar prompt: ${err instanceof Error ? err.message : 'Unknown error'}`,
      );
    }
  }

  private pythonExecutable(): string {
    return process.platform === 'win32'
      ? path.join(this.chatbotDir, '.venv', 'Scripts', 'python.exe')
      : path.join(this.chatbotDir, '.venv', 'bin', 'python');
  }

  private async isSidecarResponding(): Promise<boolean> {
    const apiUrl =
      process.env.CHATBOT_API_URL || `http://127.0.0.1:${this.port}`;
    try {
      await axios.get(`${apiUrl}/health`, { timeout: 1500 });
      return true;
    } catch {
      return false;
    }
  }

  private killOrphanSidecar(): Promise<void> {
    return new Promise((resolve) => {
      if (process.platform === 'win32') {
        resolve();
        return;
      }
      const mainPy = path.join(this.chatbotDir, 'main.py');
      exec(`pkill -f "${mainPy}"`, () => {
        // Give the OS a moment to release port 5005 before relaunching.
        setTimeout(resolve, 1500);
      });
    });
  }

  onModuleDestroy() {
    if (this.pythonProcess) {
      this.logger.log('Stopping Python chatbot sidecar process...');
      this.pythonProcess.kill();
      this.pythonProcess = null;
    }
  }


  /**
   * Ubuntu images generally ship `python3` with no `python` alias, so probing only
   * `python` reported "Python is not installed" on a host that had it.
   */
  private async resolvePythonCommand(): Promise<string | null> {
    for (const cmd of ['python3', 'python']) {
      const available = await new Promise<boolean>((resolve) => {
        exec(`${cmd} --version`, (err) => resolve(!err));
      });
      if (available) {
        return cmd;
      }
    }
    return null;
  }

  private setupVirtualEnv(pythonCmd: string): Promise<void> {
    return new Promise((resolve, reject) => {
      const venvPath = path.join(this.chatbotDir, '.venv');
      const reqPath = path.join(this.chatbotDir, 'requirements.txt');

      // If the interpreter is missing the venv is absent or half-deleted; rebuild it.
      if (!fs.existsSync(this.pythonExecutable())) {
        this.logger.log('Creating Python virtual environment (.venv)...');
        exec(`${pythonCmd} -m venv .venv`, { cwd: this.chatbotDir }, (err) => {
          if (err) {
            return reject(new Error(`Failed to create venv: ${err.message}`));
          }

          this.logger.log(
            'Installing Python dependencies from requirements.txt...',
          );
          const pipPath =
            process.platform === 'win32'
              ? path.join(venvPath, 'Scripts', 'pip.exe')
              : path.join(venvPath, 'bin', 'pip');

          exec(
            `"${pipPath}" install -r "${reqPath}"`,
            { cwd: this.chatbotDir },
            (pipErr) => {
              if (pipErr) {
                return reject(
                  new Error(
                    `Failed to install dependencies: ${pipErr.message}`,
                  ),
                );
              }
              this.logger.log('Python dependencies installed successfully.');
              resolve();
            },
          );
        });
      } else {
        resolve();
      }
    });
  }

  private startPythonApp() {
    const pythonExe = this.pythonExecutable();

    const mainPy = path.join(this.chatbotDir, 'main.py');

    this.logger.log(`Starting FastAPI application via: ${pythonExe}`);

    const geminiApiKey = this.configService.get<string>('GEMINI_API_KEY') || '';

    this.pythonProcess = spawn(pythonExe, [mainPy], {
      cwd: this.chatbotDir,
      env: {
        ...process.env,
        GEMINI_API_KEY: geminiApiKey,
        PORT: this.port.toString(),
      },
      shell: true,
    });

    this.pythonProcess.stdout?.on('data', (data) => {
      this.logger.log(`[Python Stdout] ${data.toString().trim()}`);
    });

    this.pythonProcess.stderr?.on('data', (data) => {
      this.logger.warn(`[Python Stderr] ${data.toString().trim()}`);
    });

    this.pythonProcess.on('close', (code) => {
      this.logger.warn(
        `Python chatbot sidecar process exited with code ${code}`,
      );
      this.pythonProcess = null;
    });
  }

  async sendMessage(
    message: string,
    history: Array<{ role: string; content?: string; attachments?: any[] }>,
    attachments?: any[],
    options?: { thinkingEnabled?: boolean; thinkingBudget?: number },
  ): Promise<{ response: string; thoughts?: string; thinkingTimeMs?: number }> {
    const geminiApiKey = this.configService.get<string>('GEMINI_API_KEY') || '';

    // We rely on the external Python sidecar process.
    if (!geminiApiKey) {
      this.logger.warn('GEMINI_API_KEY is not set in the environment.');
    }

    try {
      const apiUrl =
        process.env.CHATBOT_API_URL || `http://127.0.0.1:${this.port}`;
      const response = await axios.post(`${apiUrl}/chat`, {
        message,
        history,
        attachments,
        thinking_enabled: options?.thinkingEnabled ?? true,
        thinking_budget: options?.thinkingBudget ?? 2048,
      });
      
      const data = response.data;
      if (typeof data === 'string') {
        return { response: data };
      }
      return {
        response: data.response || '',
        thoughts: data.thoughts,
        thinkingTimeMs: data.thinking_time_ms,
      };
    } catch (err) {
      this.logger.error(
        `Error communicating with Python chatbot sidecar: ${err.message}`,
      );
      return {
        response: `I'm sorry, I encountered an issue communicating with my AI model. Raw error: ${err.message}`,
      };
    }
  }
}
