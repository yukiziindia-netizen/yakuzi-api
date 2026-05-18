# IDFY GST/PAN VERIFICATION AUDIT REPORT
## Current NestJS Backend vs Legacy Express Implementation

**Report Date:** March 27, 2026  
**Workspace:** PharmaBag API (NestJS 11, Prisma 6, PostgreSQL)  
**Status:** ⚠️ NOT IMPLEMENTED — 0% Complete

---

## 1. CURRENT IMPLEMENTATION STATUS

### Overall: **0% Complete**

The current NestJS backend has **NO** IDFY GST/PAN verification implementation. While the database schema captures GST and PAN numbers, the critical verification flow from the legacy system is entirely missing.

### Breakdown:

| Component | Legacy Status | Current Status | Gap |
|-----------|---------------|-----------------|-----|
| **DB Schema** | ✅ gst_pan_response (object) | ❌ Missing | No field to store IDFY response |
| **/pangst/ Endpoint** | ✅ POST route | ❌ Missing | No verification endpoint |
| **IDFY Service** | ✅ HTTP client + retry logic | ❌ Missing | No IDFY API integration |
| **Admin Approval** | ✅ Status 0-3 updates | ⚠️ Partial | Only UserStatus.APPROVED/REJECTED, no credit tier |
| **Environment Variables** | ✅ IDFY_ACCOUNT_ID, IDFY_API_KEY | ❌ Missing | Not in .env/.env.example |
| **Request/Response DTOs** | ✅ NimbusAuthDto-style | ❌ Missing | No IDFY DTO classes |
| **Error Handling** | ✅ Timeout, retry, fallback | ❌ Missing | No IDFY-specific error handling |
| **Buyer Profile Fields** | ✅ gstNumber, panNumber | ✅ gstNumber, panNumber | Present but not verified via IDFY |
| **Seller Profile Fields** | ✅ gstNumber, panNumber | ✅ gstNumber, panNumber | Present but not verified via IDFY |

---

## 2. CODE SNIPPETS: CURRENT STATE

### A. Database Schema (Prisma)

**BuyerProfile Model:**
```prisma
model BuyerProfile {
  id                String   @id @default(uuid())
  userId            String   @unique
  legalName         String
  gstNumber         String        // ← Raw input, NOT verified
  panNumber         String        // ← Raw input, NOT verified
  drugLicenseNumber String
  drugLicenseUrl    String
  address           String
  city              String
  state             String
  pincode           String
  latitude          Float?
  longitude         Float?
  createdAt         DateTime @default(now())
  updatedAt         DateTime @updatedAt

  user User @relation(fields: [userId], references: [id], onDelete: Cascade)

  @@index([city])
  @@index([state])
  @@index([pincode])
  @@map("buyer_profiles")
}
```

**SellerProfile Model:**
```prisma
model SellerProfile {
  id                 String             @id @default(uuid())
  userId             String             @unique
  companyName        String
  gstNumber          String        // ← Raw input, NOT verified
  panNumber          String        // ← Raw input, NOT verified
  drugLicenseNumber  String
  drugLicenseUrl     String
  address            String
  city               String
  state              String
  pincode            String
  isVacation         Boolean            @default(false)
  rating             Float              @default(0)
  verificationStatus VerificationStatus @default(UNVERIFIED)  // ← 4-state enum, NOT legacy 0-3
  createdAt          DateTime           @default(now())
  updatedAt          DateTime           @updatedAt

  user        User               @relation(fields: [userId], references: [id], onDelete: Cascade)
  products    Product[]
  orderItems  OrderItem[]
  settlements SellerSettlement[]

  @@index([city])
  @@index([state])
  @@index([verificationStatus])
  @@index([isVacation])
  @@map("seller_profiles")
}

enum VerificationStatus {
  UNVERIFIED
  PENDING
  VERIFIED
  REJECTED
}
```

**MISSING:** `gst_pan_response: Json?` field on both models.

---

### B. Buyer Profile Create Endpoint

**File:** `src/modules/buyers/buyers.controller.ts`

```typescript
@Post('profile')
@HttpCode(HttpStatus.CREATED)
@ApiOperation({ summary: 'Create buyer KYC profile' })
@ApiResponse({ status: 201, description: 'Buyer profile created' })
@ApiResponse({ status: 403, description: 'Forbidden — not a buyer' })
async createProfile(
  @CurrentUser('id') userId: string,
  @Body() dto: CreateBuyerProfileDto,
) {
  const data = await this.buyersService.createProfile(userId, dto);
  return { message: 'Buyer profile created successfully', data };
}
```

**File:** `src/modules/buyers/buyers.service.ts`

```typescript
async createProfile(userId: string, dto: CreateBuyerProfileDto) {
  const existing = await this.prisma.buyerProfile.findUnique({
    where: { userId },
  });

  if (existing) {
    throw new ConflictException('Buyer profile already exists');
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
      // ← NO gst_pan_response field populated
      // ← NO IDFY verification called
    },
  });

  this.logger.log(`Buyer profile created for user ${userId}`);
  return profile;
}
```

**MISSING:**
- No call to IDFY verification service
- No gst_pan_response stored
- No status update based on verification

---

### C. Seller Profile Create Endpoint

**File:** `src/modules/sellers/sellers.service.ts`

```typescript
async createProfile(userId: string, dto: CreateSellerProfileDto) {
  const existing = await this.prisma.sellerProfile.findUnique({
    where: { userId },
  });

  if (existing) {
    throw new ConflictException('Seller profile already exists');
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
      verificationStatus: 'UNVERIFIED',
      rating: 0,
      // ← NO gst_pan_response field
      // ← NO IDFY verification
    },
  });

  return profile;
}
```

---

### D. Admin User Approval (Partial)

**File:** `src/modules/admin/admin.service.ts`

```typescript
async approveUser(userId: string) {
  const user = await this.prisma.user.findUnique({
    where: { id: userId },
    include: { sellerProfile: true },
  });

  if (!user) {
    throw new NotFoundException('User not found');
  }

  // Updates to APPROVED status
  const updated = await this.prisma.user.update({
    where: { id: userId },
    data: { status: UserStatus.APPROVED },  // ← Only binary: APPROVED/REJECTED
    include: { sellerProfile: true, buyerProfile: true },
  });

  return updated;
}
```

**MISSING:**
- No GST/PAN verification status update
- No credit tier assignment (0-3)
- No gst_pan_response validation before approval

---

### E. Environment Variables

**Current .env:**
```bash
PORT=3000
DATABASE_URL=postgresql://...
JWT_SECRET=supersecret
JWT_ACCESS_EXPIRES=7d
JWT_REFRESH_EXPIRES=30d
REDIS_HOST=localhost
REDIS_PORT=6379
PLATFORM_COMMISSION_RATE=0.05
AWS_ACCESS_KEY=
AWS_SECRET_KEY=
AWS_REGION=ap-south-1
AWS_BUCKET=pharmabag-images
NIMBUS_API_URL=...
NIMBUS_USER=...
NIMBUS_KEY=...
NIMBUS_SENDER=...
# ... (Nimbus SMS config)
```

**MISSING:**
```bash
IDFY_ACCOUNT_ID=e3a89bb579fd/24d62630-66ba-4f8c-94d7-8888c094ed90
IDFY_API_KEY=43271e77-090a-4034-85e0-627ef4304d7a
```

---

## 3. LEGACY REFERENCE: WHAT NEEDS TO BE IMPLEMENTED

### Legacy Flow Diagram:
```
User submits profile (GST/PAN)
  ↓
POST /pangst/ { type_name: "GST"|"PAN", gst_number: "...", pan_number: "..." }
  ↓
[routes/pan_gst/get_details.js]
  ↓
Call IDFY API:
  POST https://eve.idfy.com/v3/tasks/sync/verify_with_source/ind_pan (or ind_gst_certificate)
  Headers: { account-id, api-key }
  Body: { task_id, group_id, data: { id_number/gstin } }
  ↓
Response:
  ✓ Success: { status: "completed", result: { source_output: { name_on_card/legal_name } } }
  ✓ Failure: { status: "failed" }
  ↓
Convert to app format: { status: true/false, legal_name: "...", gst_number: "...", message: "..." }
  ↓
Save to buyer_details.gst_pan_response
  ↓
Admin reviews gst_pan_response.status === true
  ↓
Admin updates status: 0→1→2→3
  ↓
User can place orders (status >= 1)
```

### Legacy Status Values:
| Value | Meaning | Can Order? |
|-------|---------|-----------|
| **0** | Pending/Rejected | ❌ No |
| **1** | Approved (Prepaid) | ✅ Yes, 100% upfront |
| **2** | Approved (EMI) | ✅ Yes, 25% min payment |
| **3** | Approved (Full Credit) | ✅ Yes, no upfront |

---

## 4. GAPS & MIGRATION PLAN

### Gap Analysis:

| Gap | Severity | Effort | Notes |
|-----|----------|--------|-------|
| Missing IDFY Service | 🔴 Critical | 2-3 hrs | HTTP client to eve.idfy.com, retry logic, error handling |
| Missing /pangst/ Endpoint | 🔴 Critical | 1-2 hrs | POST route to verify GST/PAN on-demand |
| Missing gst_pan_response Field | 🔴 Critical | 1-2 hrs | DB migration + schema update |
| Missing Admin GST/PAN Status Endpoint | 🟡 High | 1-2 hrs | Update buyer/seller verification status |
| Missing IDFY Environment Variables | 🔴 Critical | 0.5 hr | Add to .env/.env.example |
| Missing Request/Response DTOs | 🟡 High | 1 hr | IDFY API payload structures |
| Missing Credit Tier Mapping | 🟡 High | 1-2 hrs | Status 0-3, buyer/seller can order logic |
| No Retry Logic | 🟡 High | 1-2 hrs | 3-retry exponential backoff on IDFY timeout |
| No E2E Tests | 🟡 Medium | 2-3 hrs | Valid/invalid GST/PAN, timeout, admin approve flows |

### Migration Timeline: **5-7 Days** (Full Implementation + Testing)

#### Day 1-2: Database & DTOs
- [ ] Create Prisma migration: Add `gst_pan_response Json?` to BuyerProfile & SellerProfile
- [ ] Create IDFY request/response DTOs:
  - `IdfyPanRequestDto`, `IdfyGstRequestDto`
  - `IdfyPanResponseDto`, `IdfyGstResponseDto`
  - `IdfyVerificationDto` (standardized app format)

#### Day 2-3: IDFY Service & /pangst/ Endpoint
- [ ] Create `src/modules/verification/idfy.service.ts`:
  - `verifyPan(panNumber: string): Promise<IdfyVerificationDto>`
  - `verifyGst(gstNumber: string): Promise<IdfyVerificationDto>`
  - Retry logic (3 attempts, exponential backoff)
  - Timeout handling (10 seconds)
  - Error mapping (IDFY errors → app errors)
- [ ] Create `src/modules/verification/verification.controller.ts`:
  - `POST /verification/pangst` endpoint
  - Accept: `{ type: "GST"|"PAN", value: string }`
  - Return: `{ status: boolean, legal_name: string, ... }`
- [ ] Add IDFY_ACCOUNT_ID & IDFY_API_KEY to .env/.env.example

#### Day 3-4: Integration with Profile Creation
- [ ] Update `src/modules/buyers/buyers.service.ts`:
  - Call IDFY verification before saving gst_pan_response
  - Store full IDFY response in gst_pan_response field
- [ ] Update `src/modules/sellers/sellers.service.ts`:
  - Same IDFY verification flow
  - Set verificationStatus = "PENDING" on successful IDFY validation
- [ ] Update DTOs to accept gst_pan_response as optional

#### Day 4-5: Admin Approval with Credit Tiers
- [ ] Add `creditTier` enum to SellerProfile & BuyerProfile (PREPAID, EMI, FULL_CREDIT)
- [ ] Create admin endpoint: `PATCH /admin/buyers/:id/gst-pan-status`
  - Accept: `{ verified: boolean, creditTier: 0|1|2|3 }`
  - Update gst_pan_response & verificationStatus
- [ ] Update buyer/seller canOrder logic:
  - Check `verificationStatus === "VERIFIED" && creditTier >= 1`
- [ ] Update admin user approval to include credit tier assignment

#### Day 5-6: Testing & Error Handling
- [ ] E2E tests:
  - ✅ Valid PAN → returns legal name, stores response
  - ❌ Invalid PAN → returns status: false
  - ⏱️ Timeout after 10s → error handling
  - ✅ Admin approves → buyer can order
  - 🔄 Retry on transient failure → succeeds on 2nd attempt
- [ ] Integration tests for buyer/seller profile creation with IDFY
- [ ] Admin dashboard: Add GST/PAN verification pending count

#### Day 6-7: Migration & Deployment
- [ ] Run Prisma migration on production database
- [ ] Populate IDFY credentials in production .env
- [ ] Deploy code to staging, run E2E tests
- [ ] Deploy to production with verification monitoring
- [ ] Monitor CloudWatch logs for IDFY API errors

---

## 5. QUESTIONS & BLOCKING ISSUES

### 🔴 Critical Blockers:

1. **IDFY Credentials**
   - ❓ Do we have valid IDFY_ACCOUNT_ID and IDFY_API_KEY?
   - ❓ Has the account been tested with valid GST/PAN?
   - ❓ What is the current API rate limit?
   - **Impact:** Cannot test IDFY integration without credentials

2. **Legacy Status Mapping**
   - ❓ Current system uses UserStatus.APPROVED/REJECTED (binary)
   - ❓ Should we map: APPROVED→1 (Prepaid), VERIFIED→2 (EMI), VERIFIED→3 (Full Credit)?
   - ❓ Or keep 4-state enum (UNVERIFIED, PENDING, VERIFIED, REJECTED)?
   - **Recommendation:** Add `creditTier` field separate from `verificationStatus`

3. **Buyer Credit Eligibility**
   - ❓ Are buyers also subject to GST/PAN verification?
   - ❓ In legacy, was buyer approval based on gst_pan_response.status === true?
   - ❓ Do buyers need credit tier assignment (0-3)?
   - **Impact:** May need parallel flow for buyer profile creation

4. **Migration of Legacy Data**
   - ❓ Should we re-verify all legacy gst_pan_response data against current IDFY?
   - ❓ Or treat existing gst_pan_response as already verified?
   - **Recommendation:** Add migration script to backfill gst_pan_response for existing profiles

### 🟡 Secondary Issues:

5. **Retry Logic Configuration**
   - ❓ Should retry attempts be configurable per env?
   - ❓ Current proposal: 3 retries with exponential backoff (1s, 2s, 4s)

6. **Logging & Monitoring**
   - ❓ Should IDFY API calls be logged to database for audit trail?
   - ❓ Should we alert on repeated IDFY failures?

7. **Frontend Integration**
   - ❓ Does frontend expect gst_pan_response in profile GET response?
   - ❓ Should we return full IDFY response or just { status, legal_name, message }?

---

## 6. RECOMMENDED NEXT STEPS

### Immediate (Before Implementation):
1. ✅ Confirm IDFY credentials are valid
2. ✅ Clarify credit tier mapping (legacy 0-3 vs current enum)
3. ✅ Verify buyer GST/PAN requirement
4. ✅ Plan legacy data migration strategy

### Implementation Order:
1. Add IDFY_ACCOUNT_ID & IDFY_API_KEY to .env
2. Create Prisma migration for gst_pan_response field
3. Build IDFY service (isolated, unit-testable)
4. Create /verification/pangst endpoint
5. Integrate IDFY into profile creation flows
6. Build admin approval with credit tiers
7. Write comprehensive E2E tests
8. Test with legacy data sample
9. Deploy to staging, validate with QA
10. Production deployment with monitoring

---

## 7. FILE CHANGES SUMMARY

**New Files to Create:**
- `src/modules/verification/idfy.service.ts` — IDFY HTTP client + retry logic
- `src/modules/verification/verification.controller.ts` — /verification/pangst endpoint
- `src/modules/verification/dto/idfy-*.dto.ts` — Request/response DTOs
- `src/modules/verification/verification.module.ts` — Feature module

**Files to Modify:**
- `prisma/schema.prisma` — Add gst_pan_response, creditTier fields
- `.env.example` — Add IDFY credentials template
- `src/modules/buyers/buyers.service.ts` — IDFY integration in createProfile
- `src/modules/sellers/sellers.service.ts` — IDFY integration in createProfile
- `src/modules/admin/admin.service.ts` — Add GST/PAN approval endpoints
- `src/modules/orders/orders.service.ts` — Check verificationStatus in canPlaceOrder

**Database Migrations:**
- Migration: `xxx_add_gst_pan_response_field.sql`
- Migration: `xxx_add_credit_tier_field.sql`

---

## 8. CONCLUSION

The current NestJS implementation captures GST/PAN numbers but **does not verify them** against government databases via IDFY. The entire verification flow from the legacy system is missing.

**Recommendation:** Implement IDFY integration as outlined in this audit before accepting seller/buyer registrations in production.

**Risk Level:** 🔴 **HIGH** — GST/PAN can be fraudulent without IDFY verification.

**Timeline to 100% Parity with Legacy:** **5-7 days** with dedicated developer(s).

---

**Report Prepared By:** GitHub Copilot  
**Status:** Ready for AI Migration Guidance  
