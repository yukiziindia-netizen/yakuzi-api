# PharmaBag Legacy → v2 Migration

## Overview

This script migrates all data from the legacy PharmaBag MongoDB database into the new PostgreSQL-based v2 system. It handles:

- **Users** (buyers + sellers) → merged by phone number, with KYC/address data
- **Orders** → with cart snapshot → order items, delivery addresses
- **Payments** → linked to orders, with payment method/status mapping

## Prerequisites

1. **New API server running** on `http://localhost:3000`
2. **Admin JWT token** — log in as an ADMIN user
3. **MongoDB accessible** — the legacy database must be reachable

## Quick Start

### Step 1: Start the API server

```bash
npm run start:dev
```

### Step 2: Get an Admin JWT token

```bash
# Send OTP to admin phone
curl -X POST http://localhost:3000/api/auth/send-otp \
  -H 'Content-Type: application/json' \
  -d '{"phone": "<ADMIN_PHONE>"}'

# Verify OTP and get token
curl -X POST http://localhost:3000/api/auth/verify-otp \
  -H 'Content-Type: application/json' \
  -d '{"phone": "<ADMIN_PHONE>", "otp": "<OTP>"}'
# → copy the accessToken from the response
```

### Step 3: Run the migration (dry run first)

```bash
# Dry run — exports JSON files only, no import
DRY_RUN=true npx ts-node scripts/migrate-from-legacy.ts
```

Check the exported files in `scripts/export/`:
- `users_for_import.json` — all users ready for import
- `orders_for_import.json` — all orders ready for import
- `payments_for_import.json` — all payments ready for import

### Step 4: Run the actual migration

```bash
ADMIN_JWT_TOKEN=<your-token> npx ts-node scripts/migrate-from-legacy.ts
```

## Environment Variables

| Variable | Default | Description |
|---|---|---|
| `LEGACY_MONGODB_URL` | Legacy PharmaBag MongoDB | Connection string for legacy DB |
| `API_BASE_URL` | `http://localhost:3000/api` | New system API endpoint |
| `ADMIN_JWT_TOKEN` | *(required)* | JWT for ADMIN user |
| `BATCH_SIZE` | `50` | Records per API batch call |
| `DRY_RUN` | `false` | `true` = export only, skip import |

## Migration Pipeline

```
MongoDB Extract → Transform → Validate → Import Users → Import Orders → Import Payments → Reconcile
```

### Data Flow

1. **Extract**: Connects to legacy MongoDB, reads all collections
2. **Transform**: Normalizes data to match v2 API DTOs:
   - Phone numbers padded to 10 digits
   - Status codes mapped (0→PENDING, 1/2/3→APPROVED)
   - Order status normalized (16+ legacy statuses → 6 v2 statuses)
   - Payment types mapped (is_partial 0/1/2 → BANK_TRANSFER/PARTIAL/CREDIT)
   - KYC fields extracted from unstructured MongoDB objects
3. **Import Users**: Buyers first, then sellers. Dual-role users merged by phone.
4. **Import Orders**: Resolves buyer/seller/product IDs via migration ID maps
5. **Import Payments**: Links to migrated orders, recalculates payment statuses
6. **Reconcile**: Verifies financial integrity post-migration

### Legacy Status Mapping

| Legacy `status` | Legacy Meaning | → v2 `UserStatus` |
|---|---|---|
| `0` | Pending/Unverified | `PENDING` |
| `1` | Approved (Prepaid) | `APPROVED` |
| `2` | Approved (EMI) | `APPROVED` |
| `3` | Approved (Full Credit) | `APPROVED` |
| `is_user_block=true` | Blocked | `BLOCKED` |

### Legacy Order Status Mapping

| Legacy Status | → v2 `OrderStatus` |
|---|---|
| `Placed` | `PLACED` |
| `accepted`, `partialpayment`, `full credit`, `PAID` | `ACCEPTED` |
| `way to warehouse`, `Reached warehouse`, `Order in Transit`, `Order Shipped` | `SHIPPED` |
| `Out for Delivery` | `OUT_FOR_DELIVERY` |
| `sucessfull` (typo in legacy) | `DELIVERED` |
| `Rejected` | `CANCELLED` |

## Rollback

If something goes wrong, use the rollback endpoints:

```bash
# Roll back a specific run
curl -X DELETE http://localhost:3000/api/migration/rollback/<runId> \
  -H 'Authorization: Bearer <token>'

# Roll back everything
curl -X DELETE http://localhost:3000/api/migration/rollback-all \
  -H 'Authorization: Bearer <token>'
```

## Troubleshooting

- **"Buyer not found for legacy ID"** → Users must be imported before orders
- **"Product not found for legacy ID"** → Products must be imported first (use the products bulk import endpoint)
- **"SellerProfile not found"** → The seller user was created but profile creation failed (check KYC data)
- **401 Unauthorized** → Token expired, get a new one
- **Connection refused** → Make sure the API server is running on the correct port
