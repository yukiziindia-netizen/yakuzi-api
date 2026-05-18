import { NestFactory } from '@nestjs/core';
import { ValidationPipe, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { Logger as PinoLogger } from 'nestjs-pino';
import { AppModule } from './app.module';
import { HttpExceptionFilter } from './common/filters/http-exception.filter';

async function bootstrap() {
  const logger = new Logger('Bootstrap'); // Refreshing backend to pick up DTO changes

  const app = await NestFactory.create(AppModule, {
    bufferLogs: true,
  });

  // Use Pino structured logger
  app.useLogger(app.get(PinoLogger));

  // Global validation pipe
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      transformOptions: {
        enableImplicitConversion: true,
      },
    }),
  );

  // Global exception filter
  app.useGlobalFilters(new HttpExceptionFilter());

  // CORS — environment-based origins
  const configService = app.get(ConfigService);
  const allowedOrigins = configService
    .get<string>(
      'CORS_ORIGINS',
      'http://localhost:3000,http://localhost:3001,http://localhost:3002,http://localhost:3003,http://localhost:5173,http://localhost:5174,http://localhost:5175,' +
      'http://127.0.0.1:3000,http://127.0.0.1:3001,http://127.0.0.1:3002,http://127.0.0.1:3003,http://127.0.0.1:5173,http://127.0.0.1:5174,http://127.0.0.1:5175,' +
      'https://pharmabag-web-admin.vercel.app,https://pharmabag-web-seller.vercel.app,https://pharmabag-web-buyer.vercel.app,' +
      'https://buyer.pharmabag.com,https://seller.pharmabag.com,https://admin.pharmabag.com,' +
      'https://www.pharmabag.in,https://admin.pharmabag.in,https://seller.pharmabag.in,https://api.pharmabag.in,'
    )
    .split(',')
    .map((o) => o.trim());

  app.enableCors({
    origin: allowedOrigins,
    methods: 'GET,HEAD,PUT,PATCH,POST,DELETE,OPTIONS',
    credentials: true,
  });

  // Global API prefix
  app.setGlobalPrefix('api');

  // Swagger documentation
  const swaggerConfig = new DocumentBuilder()
    .setTitle('PharmaBag API')
    .setDescription(
      'B2B Pharmaceutical Marketplace — REST API documentation.\n\n' +
      '**Auth:** Phone OTP → JWT Bearer token.\n' +
      '**Roles:** BUYER, SELLER, ADMIN.\n' +
      'Attach the JWT token using the **Authorize** button.',
    )
    .setVersion('1.0.0')
    .addBearerAuth(
      { type: 'http', scheme: 'bearer', bearerFormat: 'JWT' },
      'JWT-auth',
    )
    .addTag('Auth', 'OTP login, token refresh, profile')
    .addTag('Buyers', 'Buyer onboarding & profile')
    .addTag('Sellers', 'Seller onboarding & profile')
    .addTag('Products', 'Product catalog CRUD & search')
    .addTag('Cart', 'Shopping cart management')
    .addTag('Orders', 'Order placement & tracking')
    .addTag('Payments', 'Manual payment recording & verification')
    .addTag('Storage', 'S3 file uploads')
    .addTag('Notifications', 'User notification feed')
    .addTag('Reviews', 'Product reviews & ratings')
    .addTag('Tickets', 'Support ticket system')
    .addTag('Settlements', 'Seller settlement & payouts')
    .addTag('Admin', 'Admin dashboard & user management')
    .addTag('Health', 'System health checks')
    .build();

  const document = SwaggerModule.createDocument(app, swaggerConfig);
  SwaggerModule.setup('api/docs', app, document, {
    swaggerOptions: {
      persistAuthorization: true,
      tagsSorter: 'alpha',
      operationsSorter: 'alpha',
    },
  });

  const port = configService.get<number>('PORT') || 3000;

  await app.listen(port, '0.0.0.0');
  logger.log(`🚀 PharmaBag API is running on: http://0.0.0.0:${port}/api`);
  logger.log(`📚 Swagger docs available at: http://0.0.0.0:${port}/api/docs`);
}
bootstrap();
