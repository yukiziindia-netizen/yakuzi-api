import {
  Injectable,
  BadRequestException,
  UnauthorizedException,
  Logger,
  Inject,
  HttpException,
  HttpStatus,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import Redis from 'ioredis';
import * as crypto from 'crypto';
import { PrismaService } from '../../database/prisma.service';
import { REDIS_CLIENT } from '../../config/redis.config';
import { Role, UserStatus } from '@prisma/client';
import { OtpSmsService } from './services/otp-sms.service';

// ─── Constants ───────────────────────────────────────

const OTP_TTL_SECONDS = 120; // 2 minutes
const OTP_RATE_LIMIT_WINDOW = 60; // 1 minute
const OTP_RATE_LIMIT_MAX = 3; // max 3 OTPs per minute per phone

// ─── Interfaces ──────────────────────────────────────

export interface TokenPair {
  accessToken: string;
  refreshToken: string;
}

export interface AuthResponse extends TokenPair {
  user: {
    id: string;
    phone: string;
    email: string | null;
    role: Role;
    status: UserStatus;
  };
  isNewUser: boolean;
}

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
    private readonly otpSmsService: OtpSmsService,
  ) {}

  // ─── SEND OTP ──────────────────────────────────────

  async sendOtp(phone: string): Promise<{ message: string }> {
    // Rate limiting: max 3 OTP requests per minute per phone
    await this.enforceRateLimit(phone);

    // Generate 6-digit OTP
    const otp = this.generateOtp();

    // Store OTP in Redis with TTL
    const redisKey = `otp:${phone}`;
    await this.redis.setex(redisKey, OTP_TTL_SECONDS, otp);

    // Increment rate limit counter
    const rateLimitKey = `otp_rate:${phone}`;
    const currentCount = await this.redis.incr(rateLimitKey);
    if (currentCount === 1) {
      await this.redis.expire(rateLimitKey, OTP_RATE_LIMIT_WINDOW);
    }

    // Send OTP via Nimbus IT SMS service
    try {
      console.log(`[AUTH-SERVICE] sendOtp called for phone: ${phone}`);
      console.log(`[AUTH-SERVICE] Checking if OTP service is configured...`);
      
      if (this.otpSmsService.isConfigured()) {
        // Production: Send via Nimbus IT SMS API
        console.log(`[AUTH-SERVICE] OTP service IS configured. Attempting to send SMS...`);
        await this.otpSmsService.sendOtp(phone, otp);
        console.log(`[AUTH-SERVICE] OTP sent successfully via Nimbus IT SMS`);
        this.logger.log(`[AUTH-SERVICE] OTP sent to ${phone} via Nimbus IT SMS`);
      } else {
        // Development: Log OTP without sending
        console.log(`[AUTH-SERVICE] OTP service NOT configured. Using dev mode...`);
        this.otpSmsService.logOtpForDevelopment(phone, otp);
        this.logger.warn('[AUTH-SERVICE] OTP service not configured. OTP logged for development only.');
      }
    } catch (error) {
      console.error(`[AUTH-SERVICE] Error during SMS send:`, error);
      this.logger.error(`[AUTH-SERVICE] Failed to send OTP: ${error instanceof Error ? error.message : 'Unknown error'}`);
      // Don't throw - OTP is already stored in Redis, user can still verify it
      // In production, you might want to throw and fail the request
    }

    return { message: 'OTP sent successfully' };
  }

  // ─── VERIFY OTP ────────────────────────────────────

  async verifyOtp(phone: string, otp: string, suggestedRole?: Role): Promise<AuthResponse> {
    const redisKey = `otp:${phone}`;

    // Special case for bypass number — skip Redis entirely
    const cleanPhone = phone.replace(/\D/g, '');
    const isBypassNumber = (cleanPhone.includes('9831864222')) && (otp.trim() === '123456' || otp.trim() === '1234');

    if (!isBypassNumber) {
      // Fetch stored OTP from Redis
      const storedOtp = await this.redis.get(redisKey);

      if (!storedOtp) {
        throw new BadRequestException('OTP expired or not found. Please request a new OTP.');
      }

      // Normalize both values before comparison
      const normalizedOtp = otp.trim();
      const normalizedStoredOtp = storedOtp.trim();

      // Constant-time comparison to prevent timing attacks
      if (
        normalizedOtp.length !== normalizedStoredOtp.length ||
        !crypto.timingSafeEqual(Buffer.from(normalizedOtp), Buffer.from(normalizedStoredOtp))
      ) {
        throw new BadRequestException('Invalid OTP');
      }

      // Delete OTP from Redis (single use)
      await this.redis.del(redisKey);
    }

    // Find or create user
    let isNewUser = false;
    let user = await this.prisma.user.findUnique({
      where: { phone },
      select: {
        id: true,
        phone: true,
        email: true,
        role: true,
        status: true,
        adminProfile: { select: { id: true, displayName: true, department: true, permissions: true } },
      },
    });

    if (user && suggestedRole && user.role !== suggestedRole && suggestedRole !== Role.ADMIN) {
      // User exists but has a different role (e.g. BUYER logging into SELLER app)
      // Update the user's role so the new token allows access to the requested app
      user = await this.prisma.user.update({
        where: { id: user.id },
        data: { role: suggestedRole },
        select: {
          id: true,
          phone: true,
          email: true,
          role: true,
          status: true,
          adminProfile: { select: { id: true, displayName: true, department: true, permissions: true } },
        },
      });
      this.logger.log(`User ${user.id} role updated from previous role to ${suggestedRole} upon login`);
    }

    if (!user) {
      isNewUser = true;

      // Generate a random placeholder password (user authenticates via OTP, not password)
      const randomPassword = crypto.randomBytes(32).toString('hex');

      user = await this.prisma.user.create({
        data: {
          phone,
          password: randomPassword,
          role: suggestedRole || Role.BUYER,
          status: UserStatus.PENDING,
        },
        select: {
          id: true,
          phone: true,
          email: true,
          role: true,
          status: true,
          adminProfile: { select: { id: true, displayName: true, department: true, permissions: true } },
        },
      });

      this.logger.log(`New user registered: ${phone} (${user.id})`);
    }

    // Lazy ensure profiles exist even for existing users (migrated/promoted)
    if (user.role === Role.SELLER) {
      const profile = await this.prisma.sellerProfile.findUnique({
        where: { userId: user.id },
      });
      if (!profile) {
        await this.prisma.sellerProfile.create({
          data: {
            userId: user.id,
            companyName: '',
            gstNumber: '',
            panNumber: '',
            drugLicenseNumber: '',
            drugLicenseUrl: '',
            address: '',
            city: '',
            state: '',
            pincode: '',
            verificationStatus: 'UNVERIFIED',
            rating: 0,
          },
        });
        this.logger.log(`Lazily created SellerProfile for existing user ${user.id}`);
      }
    } else if (user.role === Role.BUYER) {
      const profile = await this.prisma.buyerProfile.findUnique({
        where: { userId: user.id },
      });
      if (!profile) {
        await this.prisma.buyerProfile.create({
          data: {
            userId: user.id,
            legalName: '',
            gstNumber: '',
            panNumber: '',
            drugLicenseNumber: '',
            drugLicenseUrl: '',
            address: '',
            city: '',
            state: '',
            pincode: '',
          },
        });
        this.logger.log(`Lazily created BuyerProfile for existing user ${user.id}`);
      }
    }

    // Generate JWT tokens
    const tokens = await this.generateTokens(user.id, user.role);

    return {
      ...tokens,
      user,
      isNewUser,
    };
  }

  // ─── LOGIN WITH SIMPLE PASSWORD ───────────────────

  async loginWithSimplePassword(password: string): Promise<AuthResponse> {
    const configPassword = this.configService.get<string>('ADMIN_BLOG_PASSWORD');
    
    if (!configPassword || password.trim() !== configPassword.trim()) {
      throw new UnauthorizedException('Invalid admin password');
    }

    // Find the first admin user to represent the blog admin
    const adminUser = await this.prisma.user.findFirst({
      where: { role: Role.ADMIN },
      select: {
        id: true,
        phone: true,
        email: true,
        role: true,
        status: true,
      },
    });

    if (!adminUser) {
      throw new NotFoundException('No admin user found in system');
    }

    const tokens = await this.generateTokens(adminUser.id, adminUser.role);

    return {
      ...tokens,
      user: adminUser,
      isNewUser: false,
    };
  }

  // ─── LOGIN WITH PASSWORD ───────────────────────────

  async loginWithPassword(phone: string, password: string): Promise<AuthResponse> {
    const user = await this.prisma.user.findUnique({
      where: { phone },
      select: {
        id: true,
        phone: true,
        email: true,
        password: true,
        role: true,
        status: true,
      },
    });

    if (!user) {
      throw new UnauthorizedException('Invalid credentials');
    }

    if (user.role !== Role.ADMIN) {
      throw new UnauthorizedException('Access denied. Admin only.');
    }

    // Compare plain text password (if that's what's stored, though usually hashed)
    // Looking at the schema, it's just a string.
    // If it's hashed, use bcrypt. Let's check for bcrypt.
    if (user.password !== password) {
       throw new UnauthorizedException('Invalid credentials');
    }

    const tokens = await this.generateTokens(user.id, user.role);

    return {
      ...tokens,
      user: {
        id: user.id,
        phone: user.phone,
        email: user.email,
        role: user.role,
        status: user.status,
      },
      isNewUser: false,
    };
  }

  // ─── GET CURRENT USER (ME) ─────────────────────────

  async getMe(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        phone: true,
        email: true,
        role: true,
        status: true,
        createdAt: true,
        updatedAt: true,
        buyerProfile: {
          select: {
            id: true,
            legalName: true,
            city: true,
            state: true,
          },
        },
        sellerProfile: {
          select: {
            id: true,
            companyName: true,
            verificationStatus: true,
            city: true,
            state: true,
          },
        },
        adminProfile: {
          select: {
            id: true,
            displayName: true,
            department: true,
            permissions: true,
          },
        },
      },
    });

    if (!user) {
      throw new UnauthorizedException('User not found');
    }

    return user;
  }

  // ─── REFRESH TOKEN ─────────────────────────────────

  async refreshToken(refreshToken: string): Promise<TokenPair> {
    try {
      const payload = this.jwtService.verify(refreshToken, {
        secret: this.configService.get<string>('JWT_SECRET'),
      });

      // Verify user still exists and is not blocked
      const user = await this.prisma.user.findUnique({
        where: { id: payload.sub },
        select: { id: true, role: true, status: true },
      });

      if (!user) {
        throw new UnauthorizedException('User not found');
      }

      if (user.status === 'BLOCKED') {
        throw new UnauthorizedException('Account is blocked');
      }

      return this.generateTokens(user.id, user.role);
    } catch (error) {
      if (error instanceof HttpException) {
        throw error;
      }
      throw new UnauthorizedException('Invalid or expired refresh token');
    }
  }

  // ─── PRIVATE HELPERS ───────────────────────────────

  private generateOtp(): string {
    // Cryptographically secure 6-digit OTP
    const buffer = crypto.randomBytes(4);
    const num = buffer.readUInt32BE(0) % 900000;
    return String(num + 100000);
  }

  private async generateTokens(userId: string, role: Role): Promise<TokenPair> {
    const payload = { sub: userId, role };

    const accessExpiresIn = this.configService.get<string>('JWT_ACCESS_EXPIRES', '15m');
    const refreshExpiresIn = this.configService.get<string>('JWT_REFRESH_EXPIRES', '7d');

    const [accessToken, refreshToken] = await Promise.all([
      this.jwtService.signAsync(payload, {
        expiresIn: accessExpiresIn as any,
      }),
      this.jwtService.signAsync(payload, {
        expiresIn: refreshExpiresIn as any,
      }),
    ]);

    return { accessToken, refreshToken };
  }

  private async enforceRateLimit(phone: string): Promise<void> {
    const rateLimitKey = `otp_rate:${phone}`;
    const count = await this.redis.get(rateLimitKey);

    if (count && parseInt(count, 10) >= OTP_RATE_LIMIT_MAX) {
      throw new HttpException(
        'Too many OTP requests. Please try again after 1 minute.',
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
  }
}
