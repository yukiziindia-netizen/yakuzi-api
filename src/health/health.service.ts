import { Injectable, Inject } from '@nestjs/common';
import { PrismaService } from '../database/prisma.service';
import { REDIS_CLIENT } from '../config/redis.config';
import Redis from 'ioredis';

@Injectable()
export class HealthService {
  private readonly startTime = Date.now();

  constructor(
    private readonly prisma: PrismaService,
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
  ) {}

  async check() {
    const [database, redisStatus] = await Promise.all([
      this.checkDatabase(),
      this.checkRedis(),
    ]);

    const uptimeSeconds = Math.floor((Date.now() - this.startTime) / 1000);

    return {
      status: database === 'connected' && redisStatus === 'connected' ? 'ok' : 'degraded',
      database,
      redis: redisStatus,
      uptime: uptimeSeconds,
    };
  }

  private async checkDatabase(): Promise<string> {
    try {
      await this.prisma.$queryRaw`SELECT 1`;
      return 'connected';
    } catch {
      return 'disconnected';
    }
  }

  private async checkRedis(): Promise<string> {
    try {
      const pong = await this.redis.ping();
      return pong === 'PONG' ? 'connected' : 'disconnected';
    } catch {
      return 'disconnected';
    }
  }
}
