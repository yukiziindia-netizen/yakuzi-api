/**
 * PharmaBag Legacy → v2 Migration Script
 *
 * All-in-one: connects to legacy MongoDB, extracts, transforms, and imports
 * data into the new system via the Migration API endpoints.
 *
 * Usage:
 *   npx ts-node scripts/migrate-from-legacy.ts
 *
 * Environment variables (set in .env or pass directly):
 *   LEGACY_MONGODB_URL  - MongoDB connection string for the legacy database
 *   API_BASE_URL        - New system API base (default: http://localhost:3000/api)
 *   ADMIN_JWT_TOKEN     - JWT token for an ADMIN user (required for migration endpoints)
 *   BATCH_SIZE          - Records per API call (default: 50)
 *   DRY_RUN             - Set to "true" to only export JSON, skip import (default: false)
 *
 * Steps:
 *   1. Export from MongoDB → in-memory normalized records
 *   2. Optionally write JSON files to ./scripts/export/
 *   3. POST to /api/migration/validate/* (dry run)
 *   4. POST to /api/migration/import/users
 *   5. POST to /api/migration/import/orders
 *   6. POST to /api/migration/import/payments
 *   7. POST to /api/migration/reconcile
 */

import * as mongoose from 'mongoose';
import * as fs from 'fs';
import * as path from 'path';

// ─── Configuration ──────────────────────────────────────────────────────────

const LEGACY_MONGODB_URL =
  process.env.LEGACY_MONGODB_URL ||
  'mongodb+srv://pharmabag2022:VzuzZwpts0mb8sWr@cluster0.8e37j.mongodb.net/pharma-dev';

const API_BASE_URL = process.env.API_BASE_URL || 'http://localhost:3000/api';
const ADMIN_JWT_TOKEN = process.env.ADMIN_JWT_TOKEN || '';
const BATCH_SIZE = parseInt(process.env.BATCH_SIZE || '50', 10);
const DRY_RUN = process.env.DRY_RUN === 'true';
const EXPORT_DIR = path.join(__dirname, 'export');

// ─── MongoDB Schemas (strict: false to read all fields) ─────────────────────

const flexSchema = new mongoose.Schema({}, { strict: false });

// ─── Types ──────────────────────────────────────────────────────────────────

interface LegacyUserForApi {
  legacyId: string;
  phone: string;
  email?: string;
  name?: string;
  role: 'BUYER' | 'SELLER';
  status?: 'PENDING' | 'APPROVED' | 'REJECTED' | 'BLOCKED';
  companyName?: string;
  kyc?: {
    gstNumber?: string;
    panNumber?: string;
    drugLicenseNumber?: string;
    drugLicenseUrl?: string;
  };
  address?: {
    address?: string;
    city?: string;
    state?: string;
    pincode?: string;
    latitude?: number;
    longitude?: number;
  };
}

interface LegacyOrderForApi {
  legacyId: string;
  legacyBuyerId: string;
  totalAmount: number;
  orderStatus?: string;
  paymentStatus?: string;
  createdAt?: string;
  deliveryAddress?: {
    name: string;
    phone: string;
    address: string;
    city: string;
    state: string;
    pincode: string;
  };
  items: Array<{
    legacyId?: string;
    legacyProductId: string;
    legacySellerId: string;
    quantity: number;
    unitPrice: number;
    totalPrice: number;
  }>;
}

interface LegacyPaymentForApi {
  legacyId: string;
  legacyOrderId: string;
  amount: number;
  method?: string;
  referenceNumber?: string;
  proofUrl?: string;
  verificationStatus?: string;
  createdAt?: string;
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function extractField(obj: any, ...keys: string[]): any {
  if (!obj || typeof obj !== 'object') return null;
  for (const k of keys) {
    if (obj[k] !== undefined && obj[k] !== null && obj[k] !== '') return obj[k];
  }
  return null;
}

function safeParseObject(val: any): any {
  if (!val) return null;
  if (typeof val === 'string') {
    if (val === 'null' || val === '["null"]') return null;
    try {
      return JSON.parse(val);
    } catch {
      return null;
    }
  }
  if (typeof val === 'object') return val;
  return null;
}

function normalizePhone(phoneNo: any): string {
  let phone = String(phoneNo).replace(/\D/g, '');
  // Remove country code prefix if present
  if (phone.length === 12 && phone.startsWith('91')) {
    phone = phone.slice(2);
  }
  // Pad to 10 digits if truncated
  if (phone.length < 10) {
    phone = phone.padStart(10, '0');
  }
  // Truncate if too long
  if (phone.length > 10) {
    phone = phone.slice(-10);
  }
  return phone;
}

/**
 * Map legacy status code (0-3) to new system UserStatus
 */
function mapLegacyStatus(
  statusCode: number | undefined,
  isBlocked: boolean,
): 'PENDING' | 'APPROVED' | 'REJECTED' | 'BLOCKED' {
  if (isBlocked) return 'BLOCKED';
  switch (statusCode) {
    case 1:
    case 2:
    case 3:
      return 'APPROVED';
    case 0:
    default:
      return 'PENDING';
  }
}

/**
 * Map legacy order_status string to new system OrderStatus enum
 */
function mapOrderStatus(
  legacyStatus: string | undefined,
): 'PLACED' | 'ACCEPTED' | 'SHIPPED' | 'OUT_FOR_DELIVERY' | 'DELIVERED' | 'CANCELLED' {
  if (!legacyStatus) return 'PLACED';
  const normalized = legacyStatus.trim().toLowerCase();

  switch (normalized) {
    case 'placed':
      return 'PLACED';
    case 'accepted':
    case 'partialpayment':
    case 'full credit':
    case 'paid':
      return 'ACCEPTED';
    case 'way to warehouse':
    case 'reached warehouse':
    case 'order in transit':
    case 'order shipped':
      return 'SHIPPED';
    case 'out for delivery':
      return 'OUT_FOR_DELIVERY';
    case 'sucessfull':
    case 'successful':
    case 'completed':
      return 'DELIVERED';
    case 'rejected':
      return 'CANCELLED';
    case 'awaiting confirmation':
    case 'divided':
    case 'transport delay':
      return 'ACCEPTED';
    default:
      return 'PLACED';
  }
}

/**
 * Map legacy payment type to PaymentStatus
 */
function mapPaymentStatus(
  isFullPaid: number | undefined,
  isPartial: number | undefined,
  paidAmount: number | undefined,
  fullAmount: number | undefined,
): 'PENDING' | 'PARTIAL' | 'SUCCESS' | 'FAILED' {
  if (isFullPaid === 1) return 'SUCCESS';
  if ((paidAmount || 0) > 0 && (paidAmount || 0) < (fullAmount || 0)) return 'PARTIAL';
  if (isPartial === 2) return 'PENDING'; // Credit — no payment yet
  return 'PENDING';
}

/**
 * Map legacy is_partial to PaymentMethod
 */
function mapPaymentMethod(
  isPartial: number | undefined,
  pgResponse: any,
): 'BANK_TRANSFER' | 'UPI' | 'COD' | 'PARTIAL' | 'CREDIT' {
  if (isPartial === 2) return 'CREDIT';
  if (isPartial === 1) return 'PARTIAL';
  // Try to detect from PG response
  if (pgResponse && typeof pgResponse === 'object') {
    const mode = (pgResponse.payment_mode || '').toLowerCase();
    if (mode.includes('upi')) return 'UPI';
    if (mode.includes('net banking') || mode.includes('bank')) return 'BANK_TRANSFER';
  }
  return 'BANK_TRANSFER'; // default
}

/**
 * Map payment verification status
 */
function mapVerificationStatus(
  isFullPaid: number | undefined,
  pgResponse: any,
): 'PENDING' | 'CONFIRMED' | 'REJECTED' {
  if (isFullPaid === 1) return 'CONFIRMED';
  if (pgResponse && typeof pgResponse === 'object' && pgResponse.order_status === 'Success')
    return 'CONFIRMED';
  return 'PENDING';
}

function extractGstPan(gstPanResponse: any): {
  gstNumber?: string;
  panNumber?: string;
} {
  const obj = safeParseObject(gstPanResponse);
  if (!obj) return {};

  const num =
    extractField(obj, 'gst_number', 'gstin', 'gstNumber', 'GSTIN', 'gst') || '';
  const isPan = typeof num === 'string' && num.length === 10;
  const isGst = typeof num === 'string' && num.length === 15;

  return {
    gstNumber: isGst ? num : undefined,
    panNumber: isPan
      ? num
      : isGst
        ? num.substring(2, 12)
        : extractField(obj, 'pan_number', 'panNumber', 'pan', 'PAN') || undefined,
  };
}

function extractLicence(licence: any): {
  drugLicenseNumber?: string;
  drugLicenseUrl?: string;
} {
  const obj = safeParseObject(licence);
  if (!obj) return {};
  return {
    drugLicenseNumber:
      extractField(
        obj,
        'drug_license_number',
        'drugLicenseNumber',
        'license_number',
        'licenseNumber',
        'dl_number',
        'number',
        'licence_number',
        'drug_licence_number',
      ) || undefined,
    drugLicenseUrl:
      extractField(obj, 'url', 'document_url', 'documentUrl', 'image', 'file', 'doc_url') ||
      undefined,
  };
}

function extractAddress(address: any): {
  address?: string;
  city?: string;
  state?: string;
  pincode?: string;
} {
  const obj = safeParseObject(address);
  if (!obj) return {};
  return {
    address:
      extractField(
        obj,
        'street_address',
        'streetAddress',
        'street',
        'address_line1',
        'line1',
        'address',
      ) || undefined,
    city: extractField(obj, 'city', 'City') || undefined,
    state: extractField(obj, 'state', 'State') || undefined,
    pincode:
      extractField(obj, 'pincode', 'pin_code', 'zip', 'zipcode', 'postal_code', 'Pincode') ||
      undefined,
  };
}

// ─── API Client ─────────────────────────────────────────────────────────────

async function apiPost(endpoint: string, body: any): Promise<any> {
  const url = `${API_BASE_URL}${endpoint}`;
  console.log(`  POST ${url} (${JSON.stringify(body).length} bytes)`);

  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${ADMIN_JWT_TOKEN}`,
    },
    body: JSON.stringify(body),
  });

  const text = await res.text();
  let json: any;
  try {
    json = JSON.parse(text);
  } catch {
    json = { raw: text };
  }

  if (!res.ok) {
    console.error(`  ✗ ${res.status} ${res.statusText}`);
    console.error(`  Response: ${text.slice(0, 500)}`);
    throw new Error(`API error ${res.status}: ${text.slice(0, 200)}`);
  }

  console.log(
    `  ✓ ${res.status} — success: ${json?.data?.successCount ?? 'N/A'}, failed: ${json?.data?.failedCount ?? 'N/A'}`,
  );
  return json;
}

async function apiGet(endpoint: string): Promise<any> {
  const url = `${API_BASE_URL}${endpoint}`;
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${ADMIN_JWT_TOKEN}` },
  });
  return res.json();
}

// ─── Write JSON helper ──────────────────────────────────────────────────────

function writeExport(filename: string, data: any): void {
  if (!fs.existsSync(EXPORT_DIR)) fs.mkdirSync(EXPORT_DIR, { recursive: true });
  const filepath = path.join(EXPORT_DIR, filename);
  fs.writeFileSync(filepath, JSON.stringify(data, null, 2), 'utf-8');
  const count = Array.isArray(data) ? data.length : Object.keys(data).length;
  console.log(`  📁 ${filename} — ${count} records`);
}

// ─── Step 1: Extract from MongoDB ───────────────────────────────────────────

async function extractFromMongoDB(): Promise<{
  buyerAuths: any[];
  buyerDetails: any[];
  sellerAuths: any[];
  sellerDetails: any[];
  orders: any[];
  payments: any[];
  products: any[];
}> {
  console.log('\n══════════════════════════════════════════');
  console.log('  STEP 1: Extracting from Legacy MongoDB');
  console.log('══════════════════════════════════════════\n');

  await mongoose.connect(LEGACY_MONGODB_URL);
  console.log('  Connected to MongoDB\n');

  const BuyerAuth = mongoose.model('buyer_auth', flexSchema, 'buyer_auths');
  const BuyerDetails = mongoose.model('buyer_detail', flexSchema, 'buyer_details');
  const SellerAuth = mongoose.model('seller_auth', flexSchema, 'seller_auths');
  const SellerDetails = mongoose.model('seller_detail', flexSchema, 'seller_details');
  const OrderModel = mongoose.model('order', flexSchema, 'orders');
  const PaymentModel = mongoose.model('payment_record', flexSchema, 'payments');
  const ProductModel = mongoose.model('product', flexSchema, 'products');

  const [buyerAuths, buyerDetails, sellerAuths, sellerDetails, orders, payments, products] =
    await Promise.all([
      BuyerAuth.find().lean(),
      BuyerDetails.find().lean(),
      SellerAuth.find().lean(),
      SellerDetails.find().lean(),
      OrderModel.find().lean(),
      PaymentModel.find().lean(),
      ProductModel.find().lean(),
    ]);

  console.log(`  buyer_auth:    ${buyerAuths.length}`);
  console.log(`  buyer_details: ${buyerDetails.length}`);
  console.log(`  seller_auth:   ${sellerAuths.length}`);
  console.log(`  seller_details: ${sellerDetails.length}`);
  console.log(`  orders:        ${orders.length}`);
  console.log(`  payments:      ${payments.length}`);
  console.log(`  products:      ${products.length}`);

  await mongoose.disconnect();
  console.log('\n  Disconnected from MongoDB\n');

  return { buyerAuths, buyerDetails, sellerAuths, sellerDetails, orders, payments, products };
}

// ─── Step 2: Transform Users ────────────────────────────────────────────────

function transformUsers(
  buyerAuths: any[],
  buyerDetails: any[],
  sellerAuths: any[],
  sellerDetails: any[],
): LegacyUserForApi[] {
  console.log('\n══════════════════════════════════════════');
  console.log('  STEP 2: Transforming User Data');
  console.log('══════════════════════════════════════════\n');

  const users: LegacyUserForApi[] = [];

  // Build detail lookup maps (by buyer_id / seller_id)
  const buyerDetailMap: Record<string, any> = {};
  for (const bd of buyerDetails) {
    const key = String(bd.buyer_id);
    // If multiple details exist for same buyer_id, keep the latest
    if (!buyerDetailMap[key] || new Date(bd.date) > new Date(buyerDetailMap[key].date)) {
      buyerDetailMap[key] = bd;
    }
  }

  const sellerDetailMap: Record<string, any> = {};
  for (const sd of sellerDetails) {
    const key = String(sd.seller_id);
    if (!sellerDetailMap[key] || new Date(sd.date) > new Date(sellerDetailMap[key].date)) {
      sellerDetailMap[key] = sd;
    }
  }

  // Transform buyers
  for (const ba of buyerAuths) {
    const authId = String(ba._id);
    const detail = buyerDetailMap[authId];
    const phone = normalizePhone(ba.phone_no);
    const gstPan = extractGstPan(detail?.gst_pan_response);
    const licence = extractLicence(detail?.licence);
    const addr = extractAddress(detail?.address);

    users.push({
      legacyId: authId,
      phone,
      email: detail?.email || undefined,
      name: detail?.name || undefined,
      role: 'BUYER',
      status: mapLegacyStatus(detail?.status, ba.is_user_block === true),
      companyName: detail?.legal_name || detail?.name || undefined,
      kyc: {
        gstNumber: gstPan.gstNumber,
        panNumber: gstPan.panNumber,
        drugLicenseNumber: licence.drugLicenseNumber,
        drugLicenseUrl: licence.drugLicenseUrl,
      },
      address: {
        address: addr.address,
        city: addr.city,
        state: addr.state,
        pincode: addr.pincode,
      },
    });
  }

  // Transform sellers
  for (const sa of sellerAuths) {
    const authId = String(sa._id);
    const detail = sellerDetailMap[authId];
    const phone = normalizePhone(sa.phone_no);
    const gstPan = extractGstPan(detail?.gst_pan_response);
    const licence = extractLicence(detail?.licence);
    const addr = extractAddress(detail?.address);

    users.push({
      legacyId: authId,
      phone,
      email: detail?.email || undefined,
      name: detail?.name || undefined,
      role: 'SELLER',
      status: mapLegacyStatus(detail?.status, sa.is_user_block === true),
      companyName: detail?.legal_name || detail?.name || undefined,
      kyc: {
        gstNumber: gstPan.gstNumber,
        panNumber: gstPan.panNumber,
        drugLicenseNumber: licence.drugLicenseNumber,
        drugLicenseUrl: licence.drugLicenseUrl,
      },
      address: {
        address: addr.address,
        city: addr.city,
        state: addr.state,
        pincode: addr.pincode,
      },
    });
  }

  console.log(`  Total user records: ${users.length}`);
  console.log(`  Buyers: ${buyerAuths.length}, Sellers: ${sellerAuths.length}`);

  return users;
}

// ─── Step 3: Transform Orders ───────────────────────────────────────────────

function transformOrders(
  orders: any[],
  products: any[],
): LegacyOrderForApi[] {
  console.log('\n══════════════════════════════════════════');
  console.log('  STEP 3: Transforming Order Data');
  console.log('══════════════════════════════════════════\n');

  // Build product ID set for validation
  const productIds = new Set(products.map((p: any) => String(p._id)));

  const transformed: LegacyOrderForApi[] = [];
  let skippedNoCart = 0;
  let skippedSoftDeleted = 0;

  for (const order of orders) {
    // Skip soft-deleted orders (status !== 1)
    if (order.status !== undefined && order.status !== 1) {
      skippedSoftDeleted++;
      continue;
    }

    const orderId = String(order._id);
    const buyerId = String(order.buyer_id);
    const sellerId = String(order.seller_id);

    // Parse cart_details to extract line items
    const cart = safeParseObject(order.cart_details);
    if (!cart) {
      skippedNoCart++;
      continue;
    }

    // cart_details can be a single product object or an array
    // In the legacy system, each order is typically per-seller with one product
    const items: LegacyOrderForApi['items'] = [];

    // Extract product info from cart snapshot
    const productId = extractField(cart, 'product_id', 'productId', '_id') || '';
    const quantity = Number(extractField(cart, 'quantity', 'qty') || 1);

    // Price extraction from cart_details.price_details or direct fields
    const priceDetails = cart.price_details || cart;
    const unitPrice = Number(
      extractField(priceDetails, 'final_ptr', 'ptr', 'price', 'unit_price', 'product_price') || 0,
    );
    const finalOrderValue = Number(
      extractField(priceDetails, 'final_order_value', 'total', 'totalPrice', 'order_value') || 0,
    );

    items.push({
      legacyProductId: String(productId),
      legacySellerId: sellerId,
      quantity,
      unitPrice,
      totalPrice: finalOrderValue || unitPrice * quantity,
    });

    // Parse bill_details for delivery address
    const bill = safeParseObject(order.bill_details);
    let deliveryAddress: LegacyOrderForApi['deliveryAddress'] | undefined;
    if (bill) {
      deliveryAddress = {
        name: extractField(bill, 'billing_name', 'name', 'customer_name') || 'Legacy Customer',
        phone: String(
          extractField(bill, 'billing_tel', 'phone', 'phone_no', 'mobile') || '0000000000',
        ),
        address:
          extractField(
            bill,
            'billing_address',
            'street_address',
            'address',
            'line1',
          ) || 'Legacy Address',
        city: extractField(bill, 'billing_city', 'city') || 'Unknown',
        state: extractField(bill, 'billing_state', 'state') || 'Unknown',
        pincode: extractField(bill, 'billing_zip', 'pincode', 'zip') || '000000',
      };
    }

    const totalAmount = finalOrderValue || items.reduce((s, i) => s + i.totalPrice, 0);

    transformed.push({
      legacyId: orderId,
      legacyBuyerId: buyerId,
      totalAmount,
      orderStatus: mapOrderStatus(order.order_status),
      paymentStatus: 'PENDING', // Will be corrected by payment import
      createdAt: order.date ? new Date(order.date).toISOString() : undefined,
      deliveryAddress,
      items,
    });
  }

  console.log(`  Transformed: ${transformed.length} orders`);
  console.log(`  Skipped (soft-deleted): ${skippedSoftDeleted}`);
  console.log(`  Skipped (no cart data): ${skippedNoCart}`);

  return transformed;
}

// ─── Step 4: Transform Payments ─────────────────────────────────────────────

function transformPayments(payments: any[]): LegacyPaymentForApi[] {
  console.log('\n══════════════════════════════════════════');
  console.log('  STEP 4: Transforming Payment Data');
  console.log('══════════════════════════════════════════\n');

  const transformed: LegacyPaymentForApi[] = [];

  for (const p of payments) {
    const paymentId = String(p._id);
    const orderId = String(p.order_id);

    // Parse PGresponse
    let pgResponse: any = null;
    if (p.PGresponse && p.PGresponse !== 'null') {
      try {
        pgResponse = typeof p.PGresponse === 'string' ? JSON.parse(p.PGresponse) : p.PGresponse;
      } catch {
        pgResponse = null;
      }
    }

    const fullAmount = Number(p.full_ammount || p.full_amount || 0);
    const paidAmount = Number(p.paid_ammount || p.paid_amount || 0);

    // Each payment record = one payment for the order
    // The `amount` for the migration API should be the paid amount
    const amount = paidAmount > 0 ? paidAmount : fullAmount;

    const method = mapPaymentMethod(p.is_partial, pgResponse);
    const verificationStatus = mapVerificationStatus(p.isfullpaid, pgResponse);

    // Extract reference number from PG response
    let referenceNumber: string | undefined;
    if (pgResponse && typeof pgResponse === 'object') {
      referenceNumber =
        pgResponse.tracking_id || pgResponse.bank_ref_no || pgResponse.reference_id || undefined;
    }

    // Extract invoice URLs
    let proofUrl: string | undefined;
    if (Array.isArray(p.invoice) && p.invoice.length > 0 && p.invoice[0] !== 'null') {
      proofUrl = p.invoice[0];
    }

    transformed.push({
      legacyId: paymentId,
      legacyOrderId: orderId,
      amount,
      method,
      referenceNumber,
      proofUrl,
      verificationStatus,
      createdAt: p.date ? new Date(p.date).toISOString() : undefined,
    });
  }

  console.log(`  Transformed: ${transformed.length} payments`);
  return transformed;
}

// ─── Step 5: Import via API ─────────────────────────────────────────────────

async function importInBatches<T>(
  endpoint: string,
  records: T[],
  wrapKey: string,
): Promise<{ totalSuccess: number; totalFailed: number; totalSkipped: number }> {
  let totalSuccess = 0;
  let totalFailed = 0;
  let totalSkipped = 0;

  const totalBatches = Math.ceil(records.length / BATCH_SIZE);

  for (let i = 0; i < records.length; i += BATCH_SIZE) {
    const batch = records.slice(i, i + BATCH_SIZE);
    const batchNum = Math.floor(i / BATCH_SIZE) + 1;
    console.log(`  Batch ${batchNum}/${totalBatches} (${batch.length} records)...`);

    try {
      const result = await apiPost(endpoint, { [wrapKey]: batch });
      const data = result?.data || result;
      totalSuccess += data.successCount || 0;
      totalFailed += data.failedCount || 0;
      totalSkipped += data.skippedCount || 0;

      // Log any errors from this batch
      if (data.errors && data.errors.length > 0) {
        console.log(`    Errors in batch:`);
        for (const err of data.errors.slice(0, 5)) {
          console.log(`      - ${err.legacyId}: ${err.error}`);
        }
        if (data.errors.length > 5) {
          console.log(`      ... and ${data.errors.length - 5} more`);
        }
      }
    } catch (err: any) {
      console.error(`  ✗ Batch ${batchNum} failed: ${err.message}`);
      totalFailed += batch.length;
    }
  }

  return { totalSuccess, totalFailed, totalSkipped };
}

// ─── Main ───────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  console.log('╔══════════════════════════════════════════════╗');
  console.log('║  PharmaBag Legacy → v2 Migration            ║');
  console.log('╚══════════════════════════════════════════════╝');
  console.log(`  API:       ${API_BASE_URL}`);
  console.log(`  MongoDB:   ${LEGACY_MONGODB_URL.replace(/:[^@]+@/, ':***@')}`);
  console.log(`  Batch:     ${BATCH_SIZE}`);
  console.log(`  Dry Run:   ${DRY_RUN}`);
  console.log('');

  // ── Extract ──
  const raw = await extractFromMongoDB();

  // ── Transform ──
  const users = transformUsers(
    raw.buyerAuths,
    raw.buyerDetails,
    raw.sellerAuths,
    raw.sellerDetails,
  );
  const legacyOrders = transformOrders(raw.orders, raw.products);
  const legacyPayments = transformPayments(raw.payments);

  // ── Export JSON files ──
  console.log('\n══════════════════════════════════════════');
  console.log('  Writing Export Files');
  console.log('══════════════════════════════════════════\n');
  writeExport('users_for_import.json', users);
  writeExport('orders_for_import.json', legacyOrders);
  writeExport('payments_for_import.json', legacyPayments);
  writeExport('raw_buyers.json', raw.buyerAuths.length);
  writeExport('raw_sellers.json', raw.sellerAuths.length);

  if (DRY_RUN) {
    console.log('\n  ══ DRY RUN — Skipping API import ══');
    console.log(`  Export files written to: ${EXPORT_DIR}`);
    console.log('  Review the files, then re-run without DRY_RUN=true');
    return;
  }

  // ── Validate JWT token ──
  if (!ADMIN_JWT_TOKEN) {
    console.error('\n  ✗ ADMIN_JWT_TOKEN not set!');
    console.error('  Get a token by logging in as ADMIN via POST /api/auth/verify-otp');
    console.error('  Then: ADMIN_JWT_TOKEN=<token> npx ts-node scripts/migrate-from-legacy.ts');
    return;
  }

  // ── Check API health ──
  console.log('\n══════════════════════════════════════════');
  console.log('  Checking API Health');
  console.log('══════════════════════════════════════════\n');
  try {
    const health = await apiGet('/health');
    console.log(`  Health: ${JSON.stringify(health)}`);
  } catch (err: any) {
    console.error(`  ✗ API unreachable: ${err.message}`);
    console.error('  Make sure the server is running: npm run start:dev');
    return;
  }

  // ═══════════════════════════════════════════
  // IMPORT: Users → Orders → Payments
  // ═══════════════════════════════════════════

  console.log('\n══════════════════════════════════════════');
  console.log('  IMPORT PHASE 1: Users');
  console.log(`  (${users.length} records in ${Math.ceil(users.length / BATCH_SIZE)} batches)`);
  console.log('══════════════════════════════════════════\n');
  const userResult = await importInBatches('/migration/import/users', users, 'users');
  console.log(
    `\n  Users: ✓ ${userResult.totalSuccess} | ✗ ${userResult.totalFailed} | ⊘ ${userResult.totalSkipped}`,
  );

  console.log('\n══════════════════════════════════════════');
  console.log('  IMPORT PHASE 2: Orders');
  console.log(`  (${legacyOrders.length} records in ${Math.ceil(legacyOrders.length / BATCH_SIZE)} batches)`);
  console.log('══════════════════════════════════════════\n');
  const orderResult = await importInBatches('/migration/import/orders', legacyOrders, 'orders');
  console.log(
    `\n  Orders: ✓ ${orderResult.totalSuccess} | ✗ ${orderResult.totalFailed} | ⊘ ${orderResult.totalSkipped}`,
  );

  console.log('\n══════════════════════════════════════════');
  console.log('  IMPORT PHASE 3: Payments');
  console.log(`  (${legacyPayments.length} records in ${Math.ceil(legacyPayments.length / BATCH_SIZE)} batches)`);
  console.log('══════════════════════════════════════════\n');
  const paymentResult = await importInBatches(
    '/migration/import/payments',
    legacyPayments,
    'payments',
  );
  console.log(
    `\n  Payments: ✓ ${paymentResult.totalSuccess} | ✗ ${paymentResult.totalFailed} | ⊘ ${paymentResult.totalSkipped}`,
  );

  // ── Reconcile ──
  console.log('\n══════════════════════════════════════════');
  console.log('  IMPORT PHASE 4: Reconciliation');
  console.log('══════════════════════════════════════════\n');
  try {
    const recon = await apiPost('/migration/reconcile', {});
    console.log(`  Reconciliation: ${JSON.stringify(recon?.data || recon, null, 2)}`);
  } catch (err: any) {
    console.error(`  ✗ Reconciliation failed: ${err.message}`);
  }

  // ── Final Status ──
  console.log('\n══════════════════════════════════════════');
  console.log('  Migration Status');
  console.log('══════════════════════════════════════════\n');
  try {
    const status = await apiGet('/migration/status');
    console.log(JSON.stringify(status?.data || status, null, 2));
  } catch {
    console.log('  (Could not fetch status)');
  }

  // ── Summary ──
  console.log('\n╔══════════════════════════════════════════════╗');
  console.log('║  MIGRATION COMPLETE                          ║');
  console.log('╠══════════════════════════════════════════════╣');
  console.log(`║  Users:    ✓ ${String(userResult.totalSuccess).padEnd(6)} ✗ ${String(userResult.totalFailed).padEnd(6)} ⊘ ${String(userResult.totalSkipped).padEnd(6)}║`);
  console.log(`║  Orders:   ✓ ${String(orderResult.totalSuccess).padEnd(6)} ✗ ${String(orderResult.totalFailed).padEnd(6)} ⊘ ${String(orderResult.totalSkipped).padEnd(6)}║`);
  console.log(`║  Payments: ✓ ${String(paymentResult.totalSuccess).padEnd(6)} ✗ ${String(paymentResult.totalFailed).padEnd(6)} ⊘ ${String(paymentResult.totalSkipped).padEnd(6)}║`);
  console.log('╚══════════════════════════════════════════════╝');
  console.log(`\n  Export files: ${EXPORT_DIR}`);
}

main().catch((err) => {
  console.error('\nFATAL:', err);
  process.exit(1);
});
