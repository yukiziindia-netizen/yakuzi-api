import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ThrottlerModule, ThrottlerGuard } from '@nestjs/throttler';
import { APP_GUARD } from '@nestjs/core';
import { LoggerModule } from 'nestjs-pino';
import * as Joi from 'joi';

// Infrastructure modules
import { DatabaseModule } from './database/database.module';
import { RedisModule } from './config/redis.module';
import { HealthModule } from './health/health.module';

// Feature modules
import { AuthModule } from './modules/auth/auth.module';
import { UsersModule } from './modules/users/users.module';
import { BuyersModule } from './modules/buyers/buyers.module';
import { SellersModule } from './modules/sellers/sellers.module';
import { ProductsModule } from './modules/products/products.module';
import { CartModule } from './modules/cart/cart.module';
import { OrdersModule } from './modules/orders/orders.module';
import { PaymentsModule } from './modules/payments/payments.module';
import { NotificationsModule } from './modules/notifications/notifications.module';
import { AdminModule } from './modules/admin/admin.module';
import { StorageModule } from './modules/storage/storage.module';
import { SettlementsModule } from './modules/settlements/settlements.module';
import { ReviewsModule } from './modules/reviews/reviews.module';
import { TicketsModule } from './modules/tickets/tickets.module';
import { BlogModule } from './modules/blog/blog.module';
import { CategoriesModule } from './modules/categories/categories.module';
import { MigrationModule } from './modules/migration/migration.module';
import { VerificationModule } from './modules/verification/verification.module';
import { ReferralModule } from './modules/referrals/referral.module';
import { CustomOrdersModule } from './modules/custom-orders/custom-orders.module';

@Module({
  imports: [
    // ─── Global config with Joi validation ────────────
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: '.env',
      validationSchema: Joi.object({
        PORT: Joi.number().default(3000),
        DATABASE_URL: Joi.string().required(),
        JWT_SECRET: Joi.string().required(),
        REDIS_HOST: Joi.string().default('localhost'),
        REDIS_PORT: Joi.number().default(6379),
        AWS_ACCESS_KEY: Joi.string().allow('').default(''),
        AWS_SECRET_KEY: Joi.string().allow('').default(''),
        AWS_BUCKET: Joi.string().default('pharmabag-images'),
        AWS_REGION: Joi.string().default('ap-south-1'),
        CORS_ORIGINS: Joi.string().default(
          'http://localhost:3000,http://localhost:3001,http://localhost:3002,http://localhost:3003,http://localhost:5173,https://pharmabag-web-admin.vercel.app,https://pharmabag-web-seller.vercel.app,https://pharmabag-web-buyer.vercel.app,https://seller.pharmabag.com,https://admin.pharmabag.com,https://pharmabag-api.onrender.com/api,https://pharmabag-api.onrender.com,https://pharmabag.in,https://www.pharmabag.in,https://admin.pharmabag.in,https://seller.pharmabag.in,http://api.pharmabag.in,api.pharmabag.in',
        ),
        PLATFORM_COMMISSION_RATE: Joi.number().default(0.05),
      }),
      validationOptions: { abortEarly: true },
    }),

    // ─── Structured logging (Pino) ───────────────────
    LoggerModule.forRoot({
      pinoHttp: {
        transport:
          process.env.NODE_ENV !== 'production'
            ? { target: 'pino-pretty', options: { colorize: true, singleLine: true } }
            : undefined,
        autoLogging: true,
        serializers: {
          req: (req: any) => ({
            method: req.method,
            url: req.url,
          }),
          res: (res: any) => ({
            statusCode: res.statusCode,
          }),
        },
      },
    }),

    // ─── Rate limiting ───────────────────────────────
    ThrottlerModule.forRoot({
      throttlers: [{ ttl: 60000, limit: 100 }],
    }),

    // Infrastructure
    DatabaseModule,
    RedisModule,
    HealthModule,

    // Feature modules
    AuthModule,
    UsersModule,
    BuyersModule,
    SellersModule,
    ProductsModule,
    CartModule,
    OrdersModule,
    PaymentsModule,
    NotificationsModule,
    AdminModule,
    StorageModule,
    SettlementsModule,
    ReviewsModule,
    TicketsModule,
    BlogModule,
    CategoriesModule,
    MigrationModule,
    VerificationModule,
    ReferralModule,
    CustomOrdersModule,
  ],
  providers: [
    // Apply throttler guard globally
    { provide: APP_GUARD, useClass: ThrottlerGuard },
  ],
})
export class AppModule { }
