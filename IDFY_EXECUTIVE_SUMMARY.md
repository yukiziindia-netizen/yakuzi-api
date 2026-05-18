# IDFY Integration: Executive Summary for AI Migration Guidance

**Date:** March 27, 2026  
**Status:** 🔴 **0% Implemented — CRITICAL GAP**

---

## TL;DR

Current NestJS backend **captures but does NOT verify** GST/PAN numbers. The entire IDFY verification flow from legacy Express system is missing. This creates **high fraud risk** in production.

**Timeline to fix:** 5-7 days  
**Risk Level:** 🔴 CRITICAL

---

## What's Missing

| Component | Legacy | Current | Impact |
|-----------|--------|---------|--------|
| IDFY Service | ✅ Yes | ❌ No | Can't verify GST/PAN |
| /pangst/ Endpoint | ✅ Yes | ❌ No | No verification UI endpoint |
| gst_pan_response Field | ✅ Yes | ❌ No | Can't store IDFY response |
| Admin Approval (0-3 Status) | ✅ Yes | ❌ No (only binary) | No credit tier assignment |
| IDFY Env Vars | ✅ Yes | ❌ No | Can't authenticate IDFY API |
| Retry Logic | ✅ Yes | ❌ No | No resilience on timeout |

---

## Current Architecture

```
User fills GST/PAN in profile
  ↓
Profile saved to DB (NO verification)
  ↓
gstNumber & panNumber stored as raw input
  ↓
🚫 PROBLEM: Anyone can claim to be a pharmacy with fraudulent GST/PAN
  ↓
Admin can approve, but NO verification data to validate
```

---

## Required Architecture

```
User fills GST/PAN in profile
  ↓
POST /verification/pangst → IDFY API
  ↓
IDFY verifies against government database
  ↓
Response: { status: true, legal_name: "...", gst_number: "..." }
  ↓
Stored in gst_pan_response field
  ↓
Profile created with verificationStatus = PENDING
  ↓
Admin reviews gst_pan_response.status === true
  ↓
Admin approves + assigns creditTier (PREPAID/EMI/FULL_CREDIT)
  ↓
✅ Verified user can place orders
```

---

## Key Files Created

### 1. **IDFY_INTEGRATION_AUDIT.md** (Detailed)
- 200+ lines
- Full code snippets of current state
- Legacy reference specs
- 5-7 day implementation plan
- Gap analysis with severity levels

### 2. **IDFY_IMPLEMENTATION_GUIDE.md** (Step-by-Step)
- Production-ready code examples
- All 5 phases with exact file paths
- DB migrations
- Service implementation with retry logic
- E2E test suite
- Checklist

### 3. **IDFY_EXECUTIVE_SUMMARY.md** (This File)
- Quick reference
- What's missing
- Implementation overview

---

## Database Changes Required

**Add to BuyerProfile & SellerProfile:**

```prisma
gstPanResponse    Json?                    // IDFY response: { status, legal_name, gst_number, ... }
verificationStatus VerificationStatus      // UNVERIFIED, PENDING, VERIFIED, REJECTED
creditTier        CreditTier?              // PREPAID, EMI, FULL_CREDIT
```

---

## API Changes Required

**New Endpoint:**
```
POST /verification/pangst
Body: { type: "GST" | "PAN", value: "..." }
Response: { status: boolean, legal_name: string, message: string }
```

**New Admin Endpoint:**
```
PATCH /admin/sellers/:id/gst-pan-status
Body: { verified: boolean, creditTier: "PREPAID" | "EMI" | "FULL_CREDIT" }
```

---

## Environment Variables Required

```bash
IDFY_ACCOUNT_ID=e3a89bb579fd/24d62630-66ba-4f8c-94d7-8888c094ed90
IDFY_API_KEY=43271e77-090a-4034-85e0-627ef4304d7a
IDFY_TASK_ID=74f4c926-250c-43ca-9c53-453e87ceacd1
IDFY_GROUP_ID=8e16424a-58fc-4ba4-ab20-5bc8e7c3c41e
```

---

## Implementation Phases

| Phase | Days | Tasks | Deliverable |
|-------|------|-------|-------------|
| **1** | 1-2 | DB migration, DTOs | Schema updated, types defined |
| **2** | 2-3 | IDFY service, /pangst/ endpoint | Verification API working |
| **3** | 3-4 | Integrate with profile creation | GST/PAN verified on signup |
| **4** | 4-5 | Admin approval + credit tiers | Admin can approve & assign tiers |
| **5** | 5-6 | E2E tests, error handling | Full test coverage |
| **6** | 6-7 | Staging & production deploy | Live with monitoring |

---

## Code Location

All new code follows NestJS 11 patterns already established in the project:

```
src/
  modules/
    verification/              ← NEW
      idfy.service.ts         ← IDFY HTTP client + retry logic
      verification.controller.ts
      verification.module.ts
      dto/
        idfy-pan.dto.ts
        idfy-gst.dto.ts
        verify-gst-pan.dto.ts
    buyers/
      buyers.service.ts       ← UPDATE: call IDFY on createProfile
    sellers/
      sellers.service.ts      ← UPDATE: call IDFY on createProfile
    admin/
      admin.service.ts        ← UPDATE: add GST/PAN status endpoints
      admin.controller.ts
      dto/
        update-gst-pan-status.dto.ts ← NEW
prisma/
  schema.prisma               ← UPDATE: add gst_pan_response, verificationStatus, creditTier
  migrations/
    xxx_add_gst_pan_response/ ← NEW
```

---

## Questions for Implementation

### 🔴 **MUST RESOLVE BEFORE STARTING:**

1. **IDFY Credentials Valid?**
   - Have IDFY_ACCOUNT_ID & IDFY_API_KEY been tested?
   - Does account have API access enabled?
   - What is rate limit?

2. **Buyer vs Seller Parity?**
   - Do BUYERS also require GST/PAN verification?
   - Or only SELLERS?
   - Legacy system verified both?

3. **Credit Tier Mapping?**
   - Legacy status: 0 (pending), 1 (prepaid), 2 (EMI), 3 (full credit)
   - New system has enum: PREPAID, EMI, FULL_CREDIT
   - Should null creditTier = not approved?

4. **Legacy Data Migration?**
   - Existing profiles have gstNumber/panNumber but no gst_pan_response
   - Should we backfill by re-verifying against IDFY?
   - Or mark as UNVERIFIED and require re-submission?

### 🟡 **GOOD TO CLARIFY:**

5. Should IDFY failures block profile creation or continue with gst_pan_response=null?
6. Should admin dashboard show "Pending GST/PAN Verification" count?
7. Should verified profiles be searchable by legal_name from gst_pan_response?

---

## Risk Assessment

| Risk | Current | Post-Implementation |
|------|---------|------------------|
| Fraudulent GST/PAN | 🔴 HIGH | 🟢 LOW |
| Unverified sellers claiming legitimacy | 🔴 HIGH | 🟢 LOW |
| Regulatory non-compliance | 🔴 HIGH | 🟢 LOW |
| IDFY API timeout | 🟡 MEDIUM | 🟢 LOW (3x retry) |
| Admin error in approval | 🟡 MEDIUM | 🟡 MEDIUM (same) |

---

## Success Criteria

✅ All test cases pass:
- Valid PAN/GST → verified
- Invalid PAN/GST → rejected
- IDFY timeout → retry 3x then fail gracefully
- Admin approve → creditTier assigned
- User can place order only if verified

✅ Production deployment:
- No IDFY API errors in CloudWatch
- Verification latency < 5 seconds (p95)
- 0 false negatives (invalid GST/PAN passes)
- 0 false positives (valid GST/PAN fails)

✅ Documentation:
- API docs updated (/verification/pangst)
- Admin guide for GST/PAN approval
- Troubleshooting guide for IDFY failures

---

## Next Steps

1. **Confirm IDFY credentials** (5 min)
2. **Answer blocking questions** (15 min)
3. **Run prisma migration** (2 hours)
4. **Implement IDFY service** (3-4 hours)
5. **Integrate with profiles** (2-3 hours)
6. **E2E testing** (3-4 hours)
7. **Staging → Production** (1 day)

---

## Attachments

1. **IDFY_INTEGRATION_AUDIT.md** — Full audit with legacy specs
2. **IDFY_IMPLEMENTATION_GUIDE.md** — Step-by-step code guide
3. **Prisma Schema Changes** — DB migration SQL
4. **Test Suite** — E2E test cases

---

**Ready to forward to AI for migration guidance. All context and code examples included.**
