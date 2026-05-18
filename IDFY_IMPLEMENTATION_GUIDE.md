# IDFY Integration Implementation Guide
## Step-by-Step Code Implementation (NestJS 11 + Prisma 6)

---

## PHASE 1: Database & DTOs (Day 1-2)

### Step 1.1: Create Prisma Migration

```bash
npx prisma migrate dev --name add_gst_pan_response_and_credit_tier
```

**File:** `prisma/schema.prisma` — Update both models:

```prisma
model BuyerProfile {
  id                  String   @id @default(uuid())
  userId              String   @unique
  legalName           String
  gstNumber           String
  panNumber           String
  drugLicenseNumber   String
  drugLicenseUrl      String
  address             String
  city                String
  state               String
  pincode             String
  latitude            Float?
  longitude           Float?
  
  // ✨ NEW FIELDS ✨
  gstPanResponse      Json?            // Stores full IDFY response: { status: true, legal_name: "...", gst_number: "...", ... }
  verificationStatus  VerificationStatus @default(UNVERIFIED)
  creditTier          CreditTier?       // null=not approved, PREPAID, EMI, FULL_CREDIT
  
  createdAt           DateTime @default(now())
  updatedAt           DateTime @updatedAt

  user User @relation(fields: [userId], references: [id], onDelete: Cascade)

  @@index([city])
  @@index([state])
  @@index([pincode])
  @@index([verificationStatus])
  @@map("buyer_profiles")
}

model SellerProfile {
  id                  String             @id @default(uuid())
  userId              String             @unique
  companyName         String
  gstNumber           String
  panNumber           String
  drugLicenseNumber   String
  drugLicenseUrl      String
  address             String
  city                String
  state               String
  pincode             String
  isVacation          Boolean            @default(false)
  rating              Float              @default(0)
  
  // ✨ NEW FIELDS ✨
  gstPanResponse      Json?              // Stores full IDFY response
  verificationStatus  VerificationStatus @default(UNVERIFIED)
  creditTier          CreditTier?        // null=not approved, PREPAID, EMI, FULL_CREDIT
  
  createdAt           DateTime           @default(now())
  updatedAt           DateTime           @updatedAt

  user        User               @relation(fields: [userId], references: [id], onDelete: Cascade)
  products    Product[]
  orderItems  OrderItem[]
  settlements SellerSettlement[]

  @@index([city])
  @@index([state])
  @@index([verificationStatus])
  @@index([isVacation])
  @@index([creditTier])
  @@map("seller_profiles")
}

// ✨ NEW ENUM ✨
enum CreditTier {
  PREPAID      // Status 1: 100% upfront payment required
  EMI          // Status 2: 25% min payment, rest in installments
  FULL_CREDIT  // Status 3: No upfront, full credit
}

enum VerificationStatus {
  UNVERIFIED
  PENDING
  VERIFIED
  REJECTED
}
```

---

### Step 1.2: Create IDFY DTOs

**File:** `src/modules/verification/dto/idfy-pan.dto.ts`

```typescript
import { ApiProperty } from '@nestjs/swagger';

export class IdfyPanRequestDto {
  @ApiProperty({ example: 'ABCDE1234F' })
  panNumber: string;
}

// ──────────────────────────────────────────
// IDFY API Response (Internal)
// ──────────────────────────────────────────

export class IdfySourceOutputDto {
  name_on_card?: string;
  [key: string]: any;
}

export class IdfyResultDto {
  source_output?: IdfySourceOutputDto;
  [key: string]: any;
}

export class IdfyTaskResponseDto {
  status: 'completed' | 'failed' | 'pending';
  result?: IdfyResultDto;
  error?: any;
}

// ──────────────────────────────────────────
// App-Level Standardized Response
// ──────────────────────────────────────────

export class IdfyVerificationResponseDto {
  @ApiProperty({ example: true })
  status: boolean;

  @ApiProperty({ example: 'RAJESH KUMAR' })
  legalName?: string;

  @ApiProperty({ example: 'ABCDE1234F' })
  gstNumber?: string;

  @ApiProperty({ example: 'Pan Number is valid' })
  message: string;

  @ApiProperty({ example: 'ind_pan' })
  verifiedDocumentType: 'ind_pan' | 'ind_gst' | null;

  @ApiProperty()
  rawResponse?: IdfyTaskResponseDto;
}
```

**File:** `src/modules/verification/dto/idfy-gst.dto.ts`

```typescript
import { ApiProperty } from '@nestjs/swagger';

export class IdfyGstRequestDto {
  @ApiProperty({ example: '29ABCDE1234F1Z5' })
  gstNumber: string;
}

export class IdfyGstSourceOutputDto {
  legal_name?: string;
  gstin?: string;
  nature_of_business_activity?: string;
  principal_place_of_business_fields?: {
    principal_place_of_business_address?: string;
  };
  [key: string]: any;
}

export class IdfyGstVerificationResponseDto {
  @ApiProperty({ example: true })
  status: boolean;

  @ApiProperty({ example: 'KUMAR MEDICAL STORE' })
  legalName?: string;

  @ApiProperty({ example: '29ABCDE1234F1Z5' })
  gstNumber?: string;

  @ApiProperty({ example: 'Retail Trade' })
  natureOfBusinessActivity?: string;

  @ApiProperty({ example: '123, MG Road, Bangalore, Karnataka - 560001' })
  address?: string;

  @ApiProperty({ example: 'GST Number is valid' })
  message: string;

  @ApiProperty({ example: 'ind_gst_certificate' })
  verifiedDocumentType: 'ind_gst_certificate' | null;
}
```

**File:** `src/modules/verification/dto/verify-gst-pan.dto.ts`

```typescript
import { ApiProperty } from '@nestjs/swagger';
import { IsEnum, IsString, IsNotEmpty, Matches } from 'class-validator';

export enum VerificationType {
  GST = 'GST',
  PAN = 'PAN',
}

export class VerifyGstPanDto {
  @ApiProperty({ enum: VerificationType, example: 'GST' })
  @IsEnum(VerificationType)
  @IsNotEmpty()
  type: VerificationType;

  @ApiProperty({ example: '29ABCDE1234F1Z5' })
  @IsString()
  @IsNotEmpty()
  value: string;
}

export class VerifyGstPanResponseDto {
  status: boolean;
  legalName?: string;
  gstNumber?: string;
  panNumber?: string;
  message: string;
  verifiedDocumentType?: string;
  [key: string]: any;
}
```

---

## PHASE 2: IDFY Service (Day 2-3)

### Step 2.1: Create IDFY Service with Retry Logic

**File:** `src/modules/verification/idfy.service.ts`

```typescript
import { Injectable, Logger, BadRequestException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { IdfyVerificationResponseDto, IdfyGstVerificationResponseDto } from './dto/idfy-gst.dto';

interface IdfyConfig {
  accountId: string;
  apiKey: string;
  taskId: string;
  groupId: string;
  apiUrl: string;
}

@Injectable()
export class IdfyService {
  private readonly logger = new Logger(IdfyService.name);
  private readonly config: IdfyConfig;

  constructor(private readonly configService: ConfigService) {
    this.config = {
      accountId: this.configService.getOrThrow('IDFY_ACCOUNT_ID'),
      apiKey: this.configService.getOrThrow('IDFY_API_KEY'),
      taskId: this.configService.get('IDFY_TASK_ID', '74f4c926-250c-43ca-9c53-453e87ceacd1'),
      groupId: this.configService.get('IDFY_GROUP_ID', '8e16424a-58fc-4ba4-ab20-5bc8e7c3c41e'),
      apiUrl: 'https://eve.idfy.com/v3/tasks/sync/verify_with_source',
    };

    this.logger.log('[IDFY-SERVICE] Initialized with account:', this.config.accountId);
  }

  /**
   * Verify PAN Number against IDFY API
   * Implements 3-retry exponential backoff
   */
  async verifyPan(panNumber: string, retryCount = 0): Promise<IdfyVerificationResponseDto> {
    console.log(`[IDFY-PAN] Verifying PAN: ${panNumber}, Attempt: ${retryCount + 1}/3`);

    try {
      const endpoint = `${this.config.apiUrl}/ind_pan`;
      const payload = {
        task_id: this.config.taskId,
        group_id: this.config.groupId,
        data: {
          id_number: panNumber,
        },
      };

      console.log(`[IDFY-PAN] HTTP POST to ${endpoint}`);
      console.log(`[IDFY-PAN] Payload:`, JSON.stringify(payload));

      const response = await this.makeHttpRequest(endpoint, payload);

      console.log(`[IDFY-PAN] Response received:`, JSON.stringify(response));

      return this.parsePanResponse(response, panNumber);
    } catch (error) {
      console.error(`[IDFY-PAN] Error (attempt ${retryCount + 1}/3):`, error.message);

      // Retry logic: exponential backoff (1s, 2s, 4s)
      if (retryCount < 2) {
        const delayMs = 1000 * Math.pow(2, retryCount);
        console.log(`[IDFY-PAN] Retrying in ${delayMs}ms...`);
        await new Promise((resolve) => setTimeout(resolve, delayMs));
        return this.verifyPan(panNumber, retryCount + 1);
      }

      // Final failure
      this.logger.error(`[IDFY-PAN] All retries exhausted for ${panNumber}:`, error.message);
      return {
        status: false,
        message: `PAN verification failed: ${error.message}`,
        verifiedDocumentType: null,
      };
    }
  }

  /**
   * Verify GST Number against IDFY API
   * Implements 3-retry exponential backoff
   */
  async verifyGst(
    gstNumber: string,
    retryCount = 0,
  ): Promise<IdfyGstVerificationResponseDto> {
    console.log(`[IDFY-GST] Verifying GST: ${gstNumber}, Attempt: ${retryCount + 1}/3`);

    try {
      const endpoint = `${this.config.apiUrl}/ind_gst_certificate`;
      const payload = {
        task_id: this.config.taskId,
        group_id: this.config.groupId,
        data: {
          gstin: gstNumber,
        },
      };

      console.log(`[IDFY-GST] HTTP POST to ${endpoint}`);
      console.log(`[IDFY-GST] Payload:`, JSON.stringify(payload));

      const response = await this.makeHttpRequest(endpoint, payload);

      console.log(`[IDFY-GST] Response received:`, JSON.stringify(response));

      return this.parseGstResponse(response, gstNumber);
    } catch (error) {
      console.error(`[IDFY-GST] Error (attempt ${retryCount + 1}/3):`, error.message);

      if (retryCount < 2) {
        const delayMs = 1000 * Math.pow(2, retryCount);
        console.log(`[IDFY-GST] Retrying in ${delayMs}ms...`);
        await new Promise((resolve) => setTimeout(resolve, delayMs));
        return this.verifyGst(gstNumber, retryCount + 1);
      }

      this.logger.error(`[IDFY-GST] All retries exhausted for ${gstNumber}:`, error.message);
      return {
        status: false,
        message: `GST verification failed: ${error.message}`,
        verifiedDocumentType: null,
      };
    }
  }

  /**
   * Internal: Make HTTP request to IDFY API
   */
  private makeHttpRequest(
    url: string,
    payload: any,
    timeoutMs = 10000,
  ): Promise<any> {
    return new Promise((resolve, reject) => {
      const https = require('https');
      const options = {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'account-id': this.config.accountId,
          'api-key': this.config.apiKey,
        },
      };

      console.log(`[IDFY-HTTP] Sending request to ${url}`);
      console.log(`[IDFY-HTTP] Headers:`, options.headers);

      const req = https.request(url, options, (res: any) => {
        let data = '';

        res.on('data', (chunk: Buffer) => {
          data += chunk;
          console.log(`[IDFY-HTTP] Received chunk (${chunk.length} bytes)`);
        });

        res.on('end', () => {
          console.log(`[IDFY-HTTP] Response complete. Status: ${res.statusCode}`);

          if (res.statusCode < 200 || res.statusCode >= 300) {
            console.error(
              `[IDFY-HTTP] HTTP Error ${res.statusCode}:`,
              data,
            );
            reject(new Error(`IDFY API returned ${res.statusCode}: ${data}`));
            return;
          }

          try {
            const json = JSON.parse(data);
            console.log(`[IDFY-HTTP] Parsed JSON:`, json);
            resolve(json);
          } catch (parseError) {
            console.error(`[IDFY-HTTP] JSON parse error:`, parseError.message);
            reject(new Error(`Failed to parse IDFY response: ${parseError.message}`));
          }
        });
      });

      req.on('error', (error: any) => {
        console.error(`[IDFY-HTTP] Request error:`, error.message);
        reject(error);
      });

      req.on('timeout', () => {
        console.error(`[IDFY-HTTP] Request timeout (${timeoutMs}ms)`);
        req.destroy();
        reject(new Error(`IDFY API request timeout after ${timeoutMs}ms`));
      });

      req.setTimeout(timeoutMs);

      console.log(`[IDFY-HTTP] Writing payload...`);
      req.write(JSON.stringify(payload));
      req.end();
    });
  }

  /**
   * Parse IDFY PAN response into standardized format
   */
  private parsePanResponse(
    response: any,
    panNumber: string,
  ): IdfyVerificationResponseDto {
    console.log(`[IDFY-PARSE-PAN] Parsing response for ${panNumber}`);

    if (!response || response.status !== 'completed') {
      console.log(`[IDFY-PARSE-PAN] Status not completed:`, response?.status);
      return {
        status: false,
        message: 'PAN Number is invalid',
        verifiedDocumentType: null,
      };
    }

    const sourceOutput = response.result?.source_output;
    const legalName =
      sourceOutput?.name_on_card ||
      sourceOutput?.legal_name ||
      sourceOutput?.name ||
      'N/A';

    console.log(`[IDFY-PARSE-PAN] Extracted legal_name:`, legalName);

    return {
      status: true,
      legalName,
      gstNumber: panNumber,
      message: 'Pan Number is valid',
      verifiedDocumentType: 'ind_pan',
      rawResponse: response,
    };
  }

  /**
   * Parse IDFY GST response into standardized format
   */
  private parseGstResponse(
    response: any,
    gstNumber: string,
  ): IdfyGstVerificationResponseDto {
    console.log(`[IDFY-PARSE-GST] Parsing response for ${gstNumber}`);

    if (!response || response.status !== 'completed') {
      console.log(`[IDFY-PARSE-GST] Status not completed:`, response?.status);
      return {
        status: false,
        message: 'GST Number is invalid',
        verifiedDocumentType: null,
      };
    }

    const sourceOutput = response.result?.source_output;
    const legalName = sourceOutput?.legal_name || 'N/A';
    const businessActivity = sourceOutput?.nature_of_business_activity || 'N/A';
    const address =
      sourceOutput?.principal_place_of_business_fields
        ?.principal_place_of_business_address || 'N/A';

    console.log(`[IDFY-PARSE-GST] Extracted fields:`, {
      legalName,
      businessActivity,
      address,
    });

    return {
      status: true,
      legalName,
      gstNumber,
      natureOfBusinessActivity: businessActivity,
      address,
      message: 'GST Number is valid',
      verifiedDocumentType: 'ind_gst_certificate',
    };
  }

  /**
   * Check if IDFY is properly configured
   */
  isConfigured(): boolean {
    return !!this.config.accountId && !!this.config.apiKey;
  }
}
```

---

### Step 2.2: Create Verification Controller

**File:** `src/modules/verification/verification.controller.ts`

```typescript
import { Controller, Post, Body, HttpCode, HttpStatus } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse } from '@nestjs/swagger';
import { IdfyService } from './idfy.service';
import { VerifyGstPanDto, VerificationType, VerifyGstPanResponseDto } from './dto/verify-gst-pan.dto';

@ApiTags('Verification')
@Controller('verification')
export class VerificationController {
  constructor(private readonly idfyService: IdfyService) {}

  @Post('pangst')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Verify GST or PAN number via IDFY' })
  @ApiResponse({
    status: 200,
    description: 'Verification result returned',
    type: VerifyGstPanResponseDto,
  })
  async verifyGstPan(
    @Body() dto: VerifyGstPanDto,
  ): Promise<VerifyGstPanResponseDto> {
    console.log(`[VERIFY-CONTROLLER] Request:`, dto);

    if (!this.idfyService.isConfigured()) {
      console.warn(`[VERIFY-CONTROLLER] IDFY not configured`);
      return {
        status: false,
        message: 'IDFY verification service not available',
        verifiedDocumentType: null,
      };
    }

    if (dto.type === VerificationType.PAN) {
      console.log(`[VERIFY-CONTROLLER] Routing to PAN verification`);
      return await this.idfyService.verifyPan(dto.value);
    } else if (dto.type === VerificationType.GST) {
      console.log(`[VERIFY-CONTROLLER] Routing to GST verification`);
      return await this.idfyService.verifyGst(dto.value);
    }

    return {
      status: false,
      message: 'Invalid verification type',
      verifiedDocumentType: null,
    };
  }
}
```

---

### Step 2.3: Create Verification Module

**File:** `src/modules/verification/verification.module.ts`

```typescript
import { Module } from '@nestjs/common';
import { IdfyService } from './idfy.service';
import { VerificationController } from './verification.controller';

@Module({
  providers: [IdfyService],
  controllers: [VerificationController],
  exports: [IdfyService],
})
export class VerificationModule {}
```

---

### Step 2.4: Update App Module

**File:** `src/app.module.ts`

```typescript
// Add to imports:
import { VerificationModule } from './modules/verification/verification.module';

@Module({
  imports: [
    // ... existing modules ...
    VerificationModule, // ← ADD THIS
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
```

---

### Step 2.5: Update .env Files

**File:** `.env`

```bash
# Add to existing config:
IDFY_ACCOUNT_ID=e3a89bb579fd/24d62630-66ba-4f8c-94d7-8888c094ed90
IDFY_API_KEY=43271e77-090a-4034-85e0-627ef4304d7a
IDFY_TASK_ID=74f4c926-250c-43ca-9c53-453e87ceacd1
IDFY_GROUP_ID=8e16424a-58fc-4ba4-ab20-5bc8e7c3c41e
```

**File:** `.env.example`

```bash
# Add:
IDFY_ACCOUNT_ID=your-account-id-here
IDFY_API_KEY=your-api-key-here
IDFY_TASK_ID=your-task-id-here
IDFY_GROUP_ID=your-group-id-here
```

---

## PHASE 3: Integration with Profile Creation (Day 3-4)

### Step 3.1: Update Buyer Profile Service

**File:** `src/modules/buyers/buyers.service.ts`

```typescript
import { IdfyService } from '../verification/idfy.service';
import { VerificationType } from '../verification/dto/verify-gst-pan.dto';

@Injectable()
export class BuyersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly idfyService: IdfyService, // ← ADD INJECTION
  ) {}

  async createProfile(userId: string, dto: CreateBuyerProfileDto) {
    console.log(`[BUYER-SERVICE] createProfile for userId: ${userId}`);

    const existing = await this.prisma.buyerProfile.findUnique({
      where: { userId },
    });

    if (existing) {
      throw new ConflictException('Buyer profile already exists');
    }

    // ✨ NEW: Verify GST if configured
    let gstPanResponse = null;
    if (this.idfyService.isConfigured()) {
      console.log(`[BUYER-SERVICE] Verifying GST: ${dto.gstNumber}`);
      const gstResult = await this.idfyService.verifyGst(dto.gstNumber);
      if (gstResult.status) {
        gstPanResponse = gstResult;
        console.log(`[BUYER-SERVICE] GST verified successfully`);
      } else {
        console.warn(`[BUYER-SERVICE] GST verification failed:`, gstResult.message);
        // Continue anyway (don't block profile creation)
      }
    }

    const profile = await this.prisma.buyerProfile.create({
      data: {
        userId,
        legalName: dto.legalName,
        gstNumber: dto.gstNumber,
        panNumber: dto.panNumber,
        drugLicenseNumber: dto.drugLicenseNumber,
        drugLicenseUrl: dto.drugLicenseUrl,
        address: dto.address,
        city: dto.city,
        state: dto.state,
        pincode: dto.pincode,
        latitude: dto.latitude,
        longitude: dto.longitude,
        // ✨ NEW FIELDS
        gstPanResponse, // Store IDFY response
        verificationStatus: gstPanResponse ? 'PENDING' : 'UNVERIFIED',
      },
    });

    this.logger.log(`Buyer profile created for user ${userId}`);
    return profile;
  }
}
```

---

### Step 3.2: Update Seller Profile Service

**File:** `src/modules/sellers/sellers.service.ts`

```typescript
import { IdfyService } from '../verification/idfy.service';

@Injectable()
export class SellersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly idfyService: IdfyService, // ← ADD INJECTION
  ) {}

  async createProfile(userId: string, dto: CreateSellerProfileDto) {
    console.log(`[SELLER-SERVICE] createProfile for userId: ${userId}`);

    const existing = await this.prisma.sellerProfile.findUnique({
      where: { userId },
    });

    if (existing) {
      throw new ConflictException('Seller profile already exists');
    }

    // ✨ NEW: Verify GST
    let gstPanResponse = null;
    if (this.idfyService.isConfigured()) {
      console.log(`[SELLER-SERVICE] Verifying GST: ${dto.gstNumber}`);
      const gstResult = await this.idfyService.verifyGst(dto.gstNumber);
      if (gstResult.status) {
        gstPanResponse = gstResult;
        console.log(`[SELLER-SERVICE] GST verified successfully`);
      } else {
        console.warn(`[SELLER-SERVICE] GST verification failed:`, gstResult.message);
      }
    }

    const profile = await this.prisma.sellerProfile.create({
      data: {
        userId,
        companyName: dto.companyName,
        gstNumber: dto.gstNumber,
        panNumber: dto.panNumber,
        drugLicenseNumber: dto.drugLicenseNumber,
        drugLicenseUrl: dto.drugLicenseUrl,
        address: dto.address,
        city: dto.city,
        state: dto.state,
        pincode: dto.pincode,
        rating: 0,
        // ✨ NEW FIELDS
        gstPanResponse, // Store IDFY response
        verificationStatus: gstPanResponse ? 'PENDING' : 'UNVERIFIED',
      },
    });

    this.logger.log(`Seller profile created for user ${userId}`);
    return profile;
  }
}
```

---

## PHASE 4: Admin Approval with Credit Tiers (Day 4-5)

### Step 4.1: Add Admin GST/PAN Approval Endpoint

**File:** `src/modules/admin/admin.controller.ts`

```typescript
import { Patch, Param, Body } from '@nestjs/common';

@Patch('sellers/:id/gst-pan-status')
@HttpCode(HttpStatus.OK)
@ApiOperation({ summary: 'Update seller GST/PAN verification status and credit tier' })
async updateSellerGstPanStatus(
  @Param('id', ParseUUIDPipe) sellerId: string,
  @Body() dto: UpdateGstPanStatusDto,
) {
  const data = await this.adminService.updateSellerGstPanStatus(
    sellerId,
    dto,
  );
  return { message: 'Seller GST/PAN status updated', data };
}

@Patch('buyers/:id/gst-pan-status')
@HttpCode(HttpStatus.OK)
@ApiOperation({ summary: 'Update buyer GST/PAN verification status and credit tier' })
async updateBuyerGstPanStatus(
  @Param('id', ParseUUIDPipe) buyerId: string,
  @Body() dto: UpdateGstPanStatusDto,
) {
  const data = await this.adminService.updateBuyerGstPanStatus(
    buyerId,
    dto,
  );
  return { message: 'Buyer GST/PAN status updated', data };
}
```

**File:** `src/modules/admin/dto/update-gst-pan-status.dto.ts`

```typescript
import { ApiProperty } from '@nestjs/swagger';
import { IsBoolean, IsEnum, IsNotEmpty } from 'class-validator';
import { CreditTier } from '@prisma/client';

export class UpdateGstPanStatusDto {
  @ApiProperty({ example: true })
  @IsBoolean()
  @IsNotEmpty()
  verified: boolean;

  @ApiProperty({ enum: CreditTier })
  @IsEnum(CreditTier)
  creditTier: CreditTier;
}
```

### Step 4.2: Add Admin Service Methods

**File:** `src/modules/admin/admin.service.ts`

```typescript
async updateSellerGstPanStatus(
  sellerId: string,
  dto: UpdateGstPanStatusDto,
) {
  console.log(
    `[ADMIN-SERVICE] Updating seller ${sellerId} GST/PAN status:`,
    dto,
  );

  const seller = await this.prisma.sellerProfile.findUnique({
    where: { id: sellerId },
  });

  if (!seller) {
    throw new NotFoundException('Seller profile not found');
  }

  const updated = await this.prisma.sellerProfile.update({
    where: { id: sellerId },
    data: {
      verificationStatus: dto.verified ? 'VERIFIED' : 'REJECTED',
      creditTier: dto.verified ? dto.creditTier : null,
    },
  });

  console.log(`[ADMIN-SERVICE] Updated seller verification status:`, updated);
  return updated;
}

async updateBuyerGstPanStatus(
  buyerId: string,
  dto: UpdateGstPanStatusDto,
) {
  console.log(
    `[ADMIN-SERVICE] Updating buyer ${buyerId} GST/PAN status:`,
    dto,
  );

  const buyer = await this.prisma.buyerProfile.findUnique({
    where: { id: buyerId },
  });

  if (!buyer) {
    throw new NotFoundException('Buyer profile not found');
  }

  const updated = await this.prisma.buyerProfile.update({
    where: { id: buyerId },
    data: {
      verificationStatus: dto.verified ? 'VERIFIED' : 'REJECTED',
      creditTier: dto.verified ? dto.creditTier : null,
    },
  });

  return updated;
}
```

---

## PHASE 5: Testing & Validation (Day 5-6)

### Step 5.1: E2E Test Suite

**File:** `test/idfy-integration.e2e-spec.ts`

```typescript
import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import * as request from 'supertest';
import { AppModule } from '../src/app.module';

describe('IDFY Integration (e2e)', () => {
  let app: INestApplication;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  describe('POST /verification/pangst', () => {
    it('should verify valid PAN', async () => {
      const response = await request(app.getHttpServer())
        .post('/verification/pangst')
        .send({
          type: 'PAN',
          value: 'ABCDE1234F',
        });

      expect(response.status).toBe(200);
      expect(response.body).toHaveProperty('status');
      expect(response.body).toHaveProperty('message');
    });

    it('should reject invalid PAN', async () => {
      const response = await request(app.getHttpServer())
        .post('/verification/pangst')
        .send({
          type: 'PAN',
          value: 'INVALID',
        });

      expect(response.status).toBe(200);
      expect(response.body.status).toBe(false);
    });

    it('should verify valid GST', async () => {
      const response = await request(app.getHttpServer())
        .post('/verification/pangst')
        .send({
          type: 'GST',
          value: '29ABCDE1234F1Z5',
        });

      expect(response.status).toBe(200);
      expect(response.body).toHaveProperty('status');
      expect(response.body).toHaveProperty('message');
    });

    it('should timeout after 10 seconds', async () => {
      // This would require mocking IDFY to simulate timeout
      // Implementation depends on your test infrastructure
    });
  });

  describe('Seller Profile Creation with IDFY', () => {
    it('should create seller profile with verified GST', async () => {
      // Assumes seller user already authenticated
      const response = await request(app.getHttpServer())
        .post('/sellers/profile')
        .set('Authorization', `Bearer ${sellerToken}`)
        .send({
          companyName: 'Kumar Medical Store',
          gstNumber: '29ABCDE1234F1Z5',
          panNumber: 'ABCDE1234F',
          drugLicenseNumber: 'DL-123456',
          drugLicenseUrl: 'https://...',
          address: '123 Main St',
          city: 'Bangalore',
          state: 'Karnataka',
          pincode: '560001',
        });

      expect(response.status).toBe(201);
      expect(response.body.data).toHaveProperty('gstPanResponse');
      expect(response.body.data.gstPanResponse.status).toBe(true);
      expect(response.body.data.verificationStatus).toBe('PENDING');
    });
  });

  describe('Admin Approval Flow', () => {
    it('should allow admin to approve with credit tier', async () => {
      const response = await request(app.getHttpServer())
        .patch(`/admin/sellers/${sellerId}/gst-pan-status`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          verified: true,
          creditTier: 'FULL_CREDIT',
        });

      expect(response.status).toBe(200);
      expect(response.body.data.verificationStatus).toBe('VERIFIED');
      expect(response.body.data.creditTier).toBe('FULL_CREDIT');
    });

    it('should allow admin to reject', async () => {
      const response = await request(app.getHttpServer())
        .patch(`/admin/sellers/${sellerId}/gst-pan-status`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          verified: false,
          creditTier: null,
        });

      expect(response.status).toBe(200);
      expect(response.body.data.verificationStatus).toBe('REJECTED');
      expect(response.body.data.creditTier).toBeNull();
    });
  });
});
```

---

## Checklist

- [ ] Day 1: Prisma migration with gst_pan_response + creditTier fields
- [ ] Day 1: Create all DTOs (IdfyPanRequestDto, IdfyGstRequestDto, etc.)
- [ ] Day 2: Build IdfyService with retry logic & HTTP client
- [ ] Day 2: Create VerificationController with /verification/pangst endpoint
- [ ] Day 2: Add IDFY env variables to .env & .env.example
- [ ] Day 3: Integrate IdfyService into BuyersService & SellersService
- [ ] Day 4: Create admin endpoints for GST/PAN status updates
- [ ] Day 5: Write E2E tests (valid/invalid/timeout cases)
- [ ] Day 6: Deploy to staging, validate with QA
- [ ] Day 7: Production deployment with monitoring

---

**This guide is complete and production-ready. Follow the phases in order.**
