import { Injectable, Logger, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { exec, spawn, ChildProcess } from 'child_process';
import * as path from 'path';
import * as fs from 'fs';
import axios from 'axios';

@Injectable()
export class ChatbotService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(ChatbotService.name);
  private pythonProcess: ChildProcess | null = null;
  private readonly chatbotDir: string;
  private readonly port = 5005;

  constructor(private readonly configService: ConfigService) {
    this.chatbotDir = path.resolve(process.cwd(), 'chatbot');
  }

  async onModuleInit() {
    this.logger.log('Initializing Python Chatbot Sidecar...');
    
    // Check if python is available
    const hasPython = await this.checkPythonInstallation();
    if (!hasPython) {
      this.logger.warn(
        'Python is not installed or not in PATH. Spawning FastAPI chatbot sidecar will be skipped. Falling back to mock responses.',
      );
      return;
    }

    try {
      await this.setupVirtualEnv();
      this.startPythonApp();
    } catch (err) {
      this.logger.error(`Failed to setup/start Python chatbot sidecar: ${err.message}`);
    }
  }

  onModuleDestroy() {
    if (this.pythonProcess) {
      this.logger.log('Stopping Python chatbot sidecar...');
      this.pythonProcess.kill();
    }
  }

  private checkPythonInstallation(): Promise<boolean> {
    return new Promise((resolve) => {
      exec('python --version', (err) => {
        resolve(!err);
      });
    });
  }

  private setupVirtualEnv(): Promise<void> {
    return new Promise((resolve, reject) => {
      const venvPath = path.join(this.chatbotDir, '.venv');
      const reqPath = path.join(this.chatbotDir, 'requirements.txt');
      
      // If venv doesn't exist, create it
      if (!fs.existsSync(venvPath)) {
        this.logger.log('Creating Python virtual environment (.venv)...');
        exec('python -m venv .venv', { cwd: this.chatbotDir }, (err) => {
          if (err) {
            return reject(new Error(`Failed to create venv: ${err.message}`));
          }
          
          this.logger.log('Installing Python dependencies from requirements.txt...');
          const pipPath = process.platform === 'win32'
            ? path.join(venvPath, 'Scripts', 'pip.exe')
            : path.join(venvPath, 'bin', 'pip');
            
          exec(`"${pipPath}" install -r "${reqPath}"`, { cwd: this.chatbotDir }, (pipErr) => {
            if (pipErr) {
              return reject(new Error(`Failed to install dependencies: ${pipErr.message}`));
            }
            this.logger.log('Python dependencies installed successfully.');
            resolve();
          });
        });
      } else {
        resolve();
      }
    });
  }

  private startPythonApp() {
    const pythonExe = process.platform === 'win32'
      ? path.join(this.chatbotDir, '.venv', 'Scripts', 'python.exe')
      : path.join(this.chatbotDir, '.venv', 'bin', 'python');
      
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
      this.logger.warn(`Python chatbot sidecar process exited with code ${code}`);
      this.pythonProcess = null;
    });
  }

  async sendMessage(message: string, history: Array<{ role: string; content: string }>): Promise<string> {
    const geminiApiKey = this.configService.get<string>('GEMINI_API_KEY') || '';
    
    if (!this.pythonProcess || !geminiApiKey) {
      return `[MOCK MODE] Hello! I am the mock chatbot because the Python sidecar is not active or GEMINI_API_KEY is missing. You said: "${message}"`;
    }

    try {
      const response = await axios.post(`http://127.0.0.1:${this.port}/chat`, {
        message,
        history,
      });
      return response.data.response;
    } catch (err) {
      this.logger.error(`Error communicating with Python chatbot sidecar: ${err.message}`);
      return `I'm sorry, I encountered an issue communicating with my AI model. Raw error: ${err.message}`;
    }
  }
}
