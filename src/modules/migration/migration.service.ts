import {
  Injectable,
  Logger,
  BadRequestException,
  ConflictException,
} from '@nestjs/common';
import {
  Role,
  UserStatus,
  OrderStatus,
  PaymentStatus,
  PaymentMethod,
  PaymentVerificationStatus,
  MigrationEntityType,
  MigrationStatus,
  MigrationRecordStatus,
  VerificationStatus,
} from '@prisma/client';
import * as crypto from 'crypto';
import { PrismaService } from '../../database/prisma.service';
import { LegacyUserDto } from './dto/migrate-users.dto';
import { LegacyOrderDto } from './dto/migrate-orders.dto';
import { LegacyPaymentDto } from './dto/migrate-payments.dto';

// ─── Constants ────────────────────────────────────────

const BATCH_SIZE = 100; // Records per database transaction batch
const PLACEHOLDER_PASSWORD_LENGTH = 32;

// ─── Result Types ─────────────────────────────────────

export interface MigrationResult {
  runId: string;
  entityType: MigrationEntityType;
  status: MigrationStatus;
  totalRecords: number;
  successCount: number;
  failedCount: number;
  skippedCount: number;
  errors: Array<{ legacyId: string; error: string }>;
  durationMs: number;
}

export interface ValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
  summary: Record<string, number>;
}

export interface ReconciliationResult {
  usersMatched: number;
  usersMissing: number;
  ordersMatched: number;
  ordersMissing: number;
  paymentsMatched: number;
  paymentsMissing: number;
  financialSummary: {
    legacyTotalOrderValue: number;
    migratedTotalOrderValue: number;
    legacyTotalPayments: number;
    migratedTotalPayments: number;
    discrepancies: Array<{ legacyOrderId: string; field: string; expected: number; actual: number }>;
  };
  valid: boolean;
}

@Injectable()
export class MigrationService {
  private readonly logger = new Logger(MigrationService.name);

  constructor(private readonly prisma: PrismaService) {}

  // ════════════════════════════════════════════════════════
  // STEP 1: USER IMPORT PIPELINE
  // ════════════════════════════════════════════════════════

  async migrateUsers(users: LegacyUserDto[]): Promise<MigrationResult> {
    const startTime = Date.now();
    this.logger.log(`Starting user migration: ${users.length} records`);

    // Create migration run
    const run = await this.prisma.migrationRun.create({
      data: {
        entityType: MigrationEntityType.USER,
        totalRecords: users.length,
      },
    });

    const errors: Array<{ legacyId: string; error: string }> = [];
    let successCount = 0;
    let skippedCount = 0;
    let failedCount = 0;

    // Deduplicate by phone — last occurrence wins (most recent data)
    const deduped = this.deduplicateUsersByPhone(users);
    skippedCount = users.length - deduped.length;

    // Process in batches
    for (let i = 0; i < deduped.length; i += BATCH_SIZE) {
      const batch = deduped.slice(i, i + BATCH_SIZE);
      this.logger.log(`Processing user batch ${Math.floor(i / BATCH_SIZE) + 1}/${Math.ceil(deduped.length / BATCH_SIZE)}`);

      for (const legacyUser of batch) {
        try {
          await this.importSingleUser(legacyUser, run.id);
          successCount++;
        } catch (error) {
          const errMsg = error instanceof Error ? error.message : String(error);
          failedCount++;
          errors.push({ legacyId: legacyUser.legacyId, error: errMsg });

          // Record failed migration
          await this.prisma.migrationRecord.create({
            data: {
              runId: run.id,
              entityType: MigrationEntityType.USER,
              legacyId: legacyUser.legacyId,
              status: MigrationRecordStatus.FAILED,
              errorMessage: errMsg,
              rawData: legacyUser as any,
            },
          }).catch(() => {}); // Don't fail the batch on audit log failure

          this.logger.warn(`Failed to import user ${legacyUser.legacyId}: ${errMsg}`);
        }
      }
    }

    // Log skipped duplicates
    if (skippedCount > 0) {
      this.logger.warn(`Skipped ${skippedCount} duplicate users (by phone)`);
    }

    // Finalize run
    const finalStatus = failedCount === 0 ? MigrationStatus.COMPLETED : MigrationStatus.COMPLETED;
    await this.prisma.migrationRun.update({
      where: { id: run.id },
      data: {
        status: finalStatus,
        successCount,
        failedCount,
        skippedCount,
        completedAt: new Date(),
        errorSummary: errors.length > 0 ? JSON.stringify(errors.slice(0, 50)) : null,
      },
    });

    return {
      runId: run.id,
      entityType: MigrationEntityType.USER,
      status: finalStatus,
      totalRecords: users.length,
      successCount,
      failedCount,
      skippedCount,
      errors,
      durationMs: Date.now() - startTime,
    };
  }

  /**
   * Import a single legacy user:
   * 1. Check if already migrated (idempotent via MigrationIdMap)
   * 2. Check if phone already exists (merge scenario)
   * 3. Create User + Profile + ID mapping
   */
  private async importSingleUser(legacy: LegacyUserDto, runId: string): Promise<void> {
    // Idempotency check: already migrated?
    const existing = await this.prisma.migrationIdMap.findUnique({
      where: {
        entityType_legacyId: {
          entityType: MigrationEntityType.USER,
          legacyId: legacy.legacyId,
        },
      },
    });

    if (existing) {
      // Record as skipped (already migrated)
      await this.prisma.migrationRecord.upsert({
        where: {
          entityType_legacyId: {
            entityType: MigrationEntityType.USER,
            legacyId: legacy.legacyId,
          },
        },
        update: {},
        create: {
          runId,
          entityType: MigrationEntityType.USER,
          legacyId: legacy.legacyId,
          newId: existing.newId,
          status: MigrationRecordStatus.SKIPPED,
        },
      });
      return;
    }

    const role = legacy.role === 'SELLER' ? Role.SELLER : Role.BUYER;
    const status = this.mapUserStatus(legacy.status);

    // Check if phone already exists (merge with existing user)
    const existingUser = await this.prisma.user.findUnique({
      where: { phone: legacy.phone },
      select: { id: true, role: true },
    });

    let userId: string;

    if (existingUser) {
      // Phone already exists — merge: update legacyId, preserve existing user
      userId = existingUser.id;
      await this.prisma.user.update({
        where: { id: userId },
        data: { legacyId: legacy.legacyId },
      });
      this.logger.debug(`Merged legacy user ${legacy.legacyId} with existing user ${userId} (phone: ${legacy.phone})`);
    } else {
      // Create new user — NO PASSWORD (OTP-only auth)
      const placeholderPassword = crypto.randomBytes(PLACEHOLDER_PASSWORD_LENGTH).toString('hex');

      const newUser = await this.prisma.user.create({
        data: {
          phone: legacy.phone,
          email: legacy.email || null,
          password: placeholderPassword, // Never used — OTP auth only
          role,
          status,
          legacyId: legacy.legacyId,
        },
      });
      userId = newUser.id;
    }

    // Create profile if KYC/address data present
    await this.createProfileForUser(userId, legacy, role);

    // Record in ID map for order/payment resolution
    await this.prisma.migrationIdMap.create({
      data: {
        entityType: MigrationEntityType.USER,
        legacyId: legacy.legacyId,
        newId: userId,
      },
    });

    // Audit record
    await this.prisma.migrationRecord.upsert({
      where: {
        entityType_legacyId: {
          entityType: MigrationEntityType.USER,
          legacyId: legacy.legacyId,
        },
      },
      update: { newId: userId, status: MigrationRecordStatus.SUCCESS },
      create: {
        runId,
        entityType: MigrationEntityType.USER,
        legacyId: legacy.legacyId,
        newId: userId,
        status: MigrationRecordStatus.SUCCESS,
        rawData: legacy as any,
      },
    });
  }

  /**
   * Create BuyerProfile or SellerProfile from legacy KYC + address data.
   * Skip if profile already exists (merge scenario).
   */
  private async createProfileForUser(
    userId: string,
    legacy: LegacyUserDto,
    role: Role,
  ): Promise<void> {
    const kyc = legacy.kyc || {};
    const addr = legacy.address || {};

    // Normalize KYC — use 'PENDING' placeholder for missing required fields
    const gstNumber = kyc.gstNumber || 'PENDING_MIGRATION';
    const panNumber = kyc.panNumber || 'PENDING_MIGRATION';
    const drugLicenseNumber = kyc.drugLicenseNumber || 'PENDING_MIGRATION';
    const drugLicenseUrl = kyc.drugLicenseUrl || '';
    const addressStr = addr.address || 'PENDING_MIGRATION';
    const city = addr.city || 'PENDING_MIGRATION';
    const state = addr.state || 'PENDING_MIGRATION';
    const pincode = addr.pincode || '000000';

    if (role === Role.BUYER) {
      const existingProfile = await this.prisma.buyerProfile.findUnique({
        where: { userId },
      });
      if (!existingProfile) {
        await this.prisma.buyerProfile.create({
          data: {
            userId,
            legalName: legacy.name || legacy.companyName || 'PENDING_MIGRATION',
            gstNumber,
            panNumber,
            drugLicenseNumber,
            drugLicenseUrl,
            address: addressStr,
            city,
            state,
            pincode,
            latitude: addr.latitude ?? null,
            longitude: addr.longitude ?? null,
          },
        });
      }
    } else if (role === Role.SELLER) {
      const existingProfile = await this.prisma.sellerProfile.findUnique({
        where: { userId },
      });
      if (!existingProfile) {
        await this.prisma.sellerProfile.create({
          data: {
            userId,
            companyName: legacy.companyName || legacy.name || 'PENDING_MIGRATION',
            gstNumber,
            panNumber,
            drugLicenseNumber,
            drugLicenseUrl,
            address: addressStr,
            city,
            state,
            pincode,
            verificationStatus: this.mapUserStatus(legacy.status) === UserStatus.APPROVED
              ? VerificationStatus.VERIFIED
              : VerificationStatus.PENDING,
          },
        });
      }
    }
  }

  // ════════════════════════════════════════════════════════
  // STEP 3: ORDER MIGRATION PIPELINE
  // ════════════════════════════════════════════════════════

  async migrateOrders(orders: LegacyOrderDto[]): Promise<MigrationResult> {
    const startTime = Date.now();
    this.logger.log(`Starting order migration: ${orders.length} records`);

    const run = await this.prisma.migrationRun.create({
      data: {
        entityType: MigrationEntityType.ORDER,
        totalRecords: orders.length,
      },
    });

    const errors: Array<{ legacyId: string; error: string }> = [];
    let successCount = 0;
    let skippedCount = 0;
    let failedCount = 0;

    // Pre-load ID maps for fast lookups
    const userIdMap = await this.loadIdMap(MigrationEntityType.USER);
    const productIdMap = await this.loadProductExternalIdMap();

    for (let i = 0; i < orders.length; i += BATCH_SIZE) {
      const batch = orders.slice(i, i + BATCH_SIZE);
      this.logger.log(`Processing order batch ${Math.floor(i / BATCH_SIZE) + 1}/${Math.ceil(orders.length / BATCH_SIZE)}`);

      for (const legacyOrder of batch) {
        try {
          const result = await this.importSingleOrder(legacyOrder, run.id, userIdMap, productIdMap);
          if (result === 'SKIPPED') {
            skippedCount++;
          } else {
            successCount++;
          }
        } catch (error) {
          const errMsg = error instanceof Error ? error.message : String(error);
          failedCount++;
          errors.push({ legacyId: legacyOrder.legacyId, error: errMsg });

          await this.prisma.migrationRecord.create({
            data: {
              runId: run.id,
              entityType: MigrationEntityType.ORDER,
              legacyId: legacyOrder.legacyId,
              status: MigrationRecordStatus.FAILED,
              errorMessage: errMsg,
              rawData: legacyOrder as any,
            },
          }).catch(() => {});

          this.logger.warn(`Failed to import order ${legacyOrder.legacyId}: ${errMsg}`);
        }
      }
    }

    await this.prisma.migrationRun.update({
      where: { id: run.id },
      data: {
        status: MigrationStatus.COMPLETED,
        successCount,
        failedCount,
        skippedCount,
        completedAt: new Date(),
        errorSummary: errors.length > 0 ? JSON.stringify(errors.slice(0, 50)) : null,
      },
    });

    return {
      runId: run.id,
      entityType: MigrationEntityType.ORDER,
      status: MigrationStatus.COMPLETED,
      totalRecords: orders.length,
      successCount,
      failedCount,
      skippedCount,
      errors,
      durationMs: Date.now() - startTime,
    };
  }

  private async importSingleOrder(
    legacy: LegacyOrderDto,
    runId: string,
    userIdMap: Map<string, string>,
    productIdMap: Map<string, string>,
  ): Promise<'SUCCESS' | 'SKIPPED'> {
    // Idempotency
    const existing = await this.prisma.migrationIdMap.findUnique({
      where: {
        entityType_legacyId: {
          entityType: MigrationEntityType.ORDER,
          legacyId: legacy.legacyId,
        },
      },
    });
    if (existing) return 'SKIPPED';

    // Resolve buyer
    const buyerId = userIdMap.get(legacy.legacyBuyerId);
    if (!buyerId) {
      throw new Error(`Buyer not found for legacy ID: ${legacy.legacyBuyerId}. Import users first.`);
    }

    // Resolve order items
    const resolvedItems: Array<{
      productId: string;
      sellerId: string;
      quantity: number;
      unitPrice: number;
      totalPrice: number;
      legacyId?: string;
    }> = [];

    for (const item of legacy.items) {
      // Resolve product via externalId
      const productId = productIdMap.get(item.legacyProductId);
      if (!productId) {
        throw new Error(`Product not found for legacy ID: ${item.legacyProductId}`);
      }

      // Resolve seller
      const sellerId = userIdMap.get(item.legacySellerId);
      if (!sellerId) {
        throw new Error(`Seller not found for legacy ID: ${item.legacySellerId}`);
      }

      // Get seller profile ID (OrderItem.sellerId references SellerProfile, not User)
      const sellerProfile = await this.prisma.sellerProfile.findUnique({
        where: { userId: sellerId },
        select: { id: true },
      });
      if (!sellerProfile) {
        throw new Error(`SellerProfile not found for user ${sellerId} (legacy seller: ${item.legacySellerId})`);
      }

      resolvedItems.push({
        productId,
        sellerId: sellerProfile.id,
        quantity: item.quantity,
        unitPrice: item.unitPrice,
        totalPrice: item.totalPrice,
        legacyId: item.legacyId,
      });
    }

    // Create order + items + address in a single transaction
    const order = await this.prisma.$transaction(async (tx) => {
      const newOrder = await tx.order.create({
        data: {
          buyerId,
          totalAmount: legacy.totalAmount,
          orderStatus: this.mapOrderStatus(legacy.orderStatus),
          paymentStatus: this.mapPaymentStatus(legacy.paymentStatus),
          legacyId: legacy.legacyId,
          ...(legacy.createdAt ? { createdAt: new Date(legacy.createdAt) } : {}),
          items: {
            create: resolvedItems.map((item) => ({
              productId: item.productId,
              sellerId: item.sellerId,
              quantity: item.quantity,
              unitPrice: item.unitPrice,
              totalPrice: item.totalPrice,
              legacyId: item.legacyId || null,
            })),
          },
          ...(legacy.deliveryAddress
            ? {
                address: {
                  create: {
                    name: legacy.deliveryAddress.name,
                    phone: legacy.deliveryAddress.phone,
                    address: legacy.deliveryAddress.address,
                    city: legacy.deliveryAddress.city,
                    state: legacy.deliveryAddress.state,
                    pincode: legacy.deliveryAddress.pincode,
                  },
                },
              }
            : {}),
        },
        include: { items: true },
      });

      return newOrder;
    });

    // Register in ID map
    await this.prisma.migrationIdMap.create({
      data: {
        entityType: MigrationEntityType.ORDER,
        legacyId: legacy.legacyId,
        newId: order.id,
      },
    });

    // Register order item ID maps
    for (const item of order.items) {
      if (item.legacyId) {
        await this.prisma.migrationIdMap.create({
          data: {
            entityType: MigrationEntityType.ORDER_ITEM,
            legacyId: item.legacyId,
            newId: item.id,
          },
        }).catch(() => {}); // Ignore duplicates
      }
    }

    // Audit record
    await this.prisma.migrationRecord.upsert({
      where: {
        entityType_legacyId: {
          entityType: MigrationEntityType.ORDER,
          legacyId: legacy.legacyId,
        },
      },
      update: { newId: order.id, status: MigrationRecordStatus.SUCCESS },
      create: {
        runId,
        entityType: MigrationEntityType.ORDER,
        legacyId: legacy.legacyId,
        newId: order.id,
        status: MigrationRecordStatus.SUCCESS,
        rawData: legacy as any,
      },
    });

    return 'SUCCESS';
  }

  // ════════════════════════════════════════════════════════
  // STEP 4: PAYMENT MIGRATION PIPELINE
  // ════════════════════════════════════════════════════════

  async migratePayments(payments: LegacyPaymentDto[]): Promise<MigrationResult> {
    const startTime = Date.now();
    this.logger.log(`Starting payment migration: ${payments.length} records`);

    const run = await this.prisma.migrationRun.create({
      data: {
        entityType: MigrationEntityType.PAYMENT,
        totalRecords: payments.length,
      },
    });

    const errors: Array<{ legacyId: string; error: string }> = [];
    let successCount = 0;
    let skippedCount = 0;
    let failedCount = 0;

    // Pre-load order ID map
    const orderIdMap = await this.loadIdMap(MigrationEntityType.ORDER);

    for (let i = 0; i < payments.length; i += BATCH_SIZE) {
      const batch = payments.slice(i, i + BATCH_SIZE);
      this.logger.log(`Processing payment batch ${Math.floor(i / BATCH_SIZE) + 1}/${Math.ceil(payments.length / BATCH_SIZE)}`);

      for (const legacyPayment of batch) {
        try {
          const result = await this.importSinglePayment(legacyPayment, run.id, orderIdMap);
          if (result === 'SKIPPED') {
            skippedCount++;
          } else {
            successCount++;
          }
        } catch (error) {
          const errMsg = error instanceof Error ? error.message : String(error);
          failedCount++;
          errors.push({ legacyId: legacyPayment.legacyId, error: errMsg });

          await this.prisma.migrationRecord.create({
            data: {
              runId: run.id,
              entityType: MigrationEntityType.PAYMENT,
              legacyId: legacyPayment.legacyId,
              status: MigrationRecordStatus.FAILED,
              errorMessage: errMsg,
              rawData: legacyPayment as any,
            },
          }).catch(() => {});

          this.logger.warn(`Failed to import payment ${legacyPayment.legacyId}: ${errMsg}`);
        }
      }
    }

    // After all payments imported, recalculate order payment statuses
    await this.recalculateOrderPaymentStatuses(orderIdMap);

    await this.prisma.migrationRun.update({
      where: { id: run.id },
      data: {
        status: MigrationStatus.COMPLETED,
        successCount,
        failedCount,
        skippedCount,
        completedAt: new Date(),
        errorSummary: errors.length > 0 ? JSON.stringify(errors.slice(0, 50)) : null,
      },
    });

    return {
      runId: run.id,
      entityType: MigrationEntityType.PAYMENT,
      status: MigrationStatus.COMPLETED,
      totalRecords: payments.length,
      successCount,
      failedCount,
      skippedCount,
      errors,
      durationMs: Date.now() - startTime,
    };
  }

  private async importSinglePayment(
    legacy: LegacyPaymentDto,
    runId: string,
    orderIdMap: Map<string, string>,
  ): Promise<'SUCCESS' | 'SKIPPED'> {
    // Idempotency
    const existing = await this.prisma.migrationIdMap.findUnique({
      where: {
        entityType_legacyId: {
          entityType: MigrationEntityType.PAYMENT,
          legacyId: legacy.legacyId,
        },
      },
    });
    if (existing) return 'SKIPPED';

    // Resolve order
    const orderId = orderIdMap.get(legacy.legacyOrderId);
    if (!orderId) {
      throw new Error(`Order not found for legacy ID: ${legacy.legacyOrderId}. Import orders first.`);
    }

    const payment = await this.prisma.payment.create({
      data: {
        orderId,
        amount: legacy.amount,
        method: this.mapPaymentMethod(legacy.method),
        referenceNumber: legacy.referenceNumber || null,
        proofUrl: legacy.proofUrl || null,
        verificationStatus: this.mapVerificationStatus(legacy.verificationStatus),
        legacyId: legacy.legacyId,
        ...(legacy.createdAt ? { createdAt: new Date(legacy.createdAt) } : {}),
      },
    });

    // ID map
    await this.prisma.migrationIdMap.create({
      data: {
        entityType: MigrationEntityType.PAYMENT,
        legacyId: legacy.legacyId,
        newId: payment.id,
      },
    });

    // Audit
    await this.prisma.migrationRecord.upsert({
      where: {
        entityType_legacyId: {
          entityType: MigrationEntityType.PAYMENT,
          legacyId: legacy.legacyId,
        },
      },
      update: { newId: payment.id, status: MigrationRecordStatus.SUCCESS },
      create: {
        runId,
        entityType: MigrationEntityType.PAYMENT,
        legacyId: legacy.legacyId,
        newId: payment.id,
        status: MigrationRecordStatus.SUCCESS,
        rawData: legacy as any,
      },
    });

    return 'SUCCESS';
  }

  /**
   * After payment import, recalculate order.paymentStatus based on confirmed payments.
   * Ensures no financial mismatch between legacy and migrated data.
   */
  private async recalculateOrderPaymentStatuses(
    orderIdMap: Map<string, string>,
  ): Promise<void> {
    this.logger.log('Recalculating order payment statuses...');

    for (const [, orderId] of orderIdMap) {
      const order = await this.prisma.order.findUnique({
        where: { id: orderId },
        select: { id: true, totalAmount: true },
      });
      if (!order) continue;

      const confirmedPayments = await this.prisma.payment.aggregate({
        where: {
          orderId: order.id,
          verificationStatus: PaymentVerificationStatus.CONFIRMED,
        },
        _sum: { amount: true },
      });

      const totalPaid = confirmedPayments._sum.amount ?? 0;
      let newStatus: PaymentStatus;

      if (totalPaid >= order.totalAmount) {
        newStatus = PaymentStatus.SUCCESS;
      } else if (totalPaid > 0) {
        newStatus = PaymentStatus.PARTIAL;
      } else {
        newStatus = PaymentStatus.PENDING;
      }

      await this.prisma.order.update({
        where: { id: order.id },
        data: { paymentStatus: newStatus },
      });
    }

    this.logger.log('Order payment status recalculation complete');
  }

  // ════════════════════════════════════════════════════════
  // STEP 5: DATA VALIDATION
  // ════════════════════════════════════════════════════════

  /**
   * Pre-import validation: checks data integrity BEFORE importing.
   */
  async validateUsers(users: LegacyUserDto[]): Promise<ValidationResult> {
    const errors: string[] = [];
    const warnings: string[] = [];
    const phoneCounts = new Map<string, number>();

    for (let i = 0; i < users.length; i++) {
      const u = users[i];

      if (!u.legacyId) errors.push(`users[${i}]: missing legacyId`);
      if (!u.phone || !/^\d{10}$/.test(u.phone)) errors.push(`users[${i}]: invalid phone "${u.phone}"`);
      if (!u.role || !['BUYER', 'SELLER'].includes(u.role)) errors.push(`users[${i}]: invalid role "${u.role}"`);

      // Duplicate phone detection
      const count = (phoneCounts.get(u.phone) || 0) + 1;
      phoneCounts.set(u.phone, count);
      if (count > 1) warnings.push(`users[${i}]: duplicate phone ${u.phone} (occurrence #${count}, last wins)`);

      // KYC completeness
      if (u.role === 'SELLER' && !u.companyName) warnings.push(`users[${i}]: seller missing companyName`);
      if (!u.kyc?.gstNumber) warnings.push(`users[${i}]: missing GST number`);
    }

    return {
      valid: errors.length === 0,
      errors,
      warnings,
      summary: {
        total: users.length,
        buyers: users.filter((u) => u.role === 'BUYER').length,
        sellers: users.filter((u) => u.role === 'SELLER').length,
        uniquePhones: phoneCounts.size,
        duplicatePhones: [...phoneCounts.values()].filter((c) => c > 1).length,
      },
    };
  }

  async validateOrders(orders: LegacyOrderDto[]): Promise<ValidationResult> {
    const errors: string[] = [];
    const warnings: string[] = [];
    const userIdMap = await this.loadIdMap(MigrationEntityType.USER);
    const productIdMap = await this.loadProductExternalIdMap();

    for (let i = 0; i < orders.length; i++) {
      const o = orders[i];

      if (!o.legacyId) errors.push(`orders[${i}]: missing legacyId`);
      if (!o.legacyBuyerId) errors.push(`orders[${i}]: missing legacyBuyerId`);
      if (!userIdMap.has(o.legacyBuyerId)) errors.push(`orders[${i}]: buyer ${o.legacyBuyerId} not in ID map`);
      if (!o.items || o.items.length === 0) errors.push(`orders[${i}]: no items`);

      // Validate items
      let calculatedTotal = 0;
      for (let j = 0; j < (o.items || []).length; j++) {
        const item = o.items[j];
        if (!productIdMap.has(item.legacyProductId)) {
          errors.push(`orders[${i}].items[${j}]: product ${item.legacyProductId} not found`);
        }
        if (!userIdMap.has(item.legacySellerId)) {
          errors.push(`orders[${i}].items[${j}]: seller ${item.legacySellerId} not in ID map`);
        }
        calculatedTotal += item.totalPrice;
      }

      // Financial integrity
      if (Math.abs(calculatedTotal - o.totalAmount) > 0.01) {
        warnings.push(
          `orders[${i}]: totalAmount mismatch. Declared: ${o.totalAmount}, Sum of items: ${calculatedTotal}`,
        );
      }
    }

    return {
      valid: errors.length === 0,
      errors,
      warnings,
      summary: {
        total: orders.length,
        resolvableBuyers: orders.filter((o) => userIdMap.has(o.legacyBuyerId)).length,
        unresolvableBuyers: orders.filter((o) => !userIdMap.has(o.legacyBuyerId)).length,
      },
    };
  }

  async validatePayments(payments: LegacyPaymentDto[]): Promise<ValidationResult> {
    const errors: string[] = [];
    const warnings: string[] = [];
    const orderIdMap = await this.loadIdMap(MigrationEntityType.ORDER);

    for (let i = 0; i < payments.length; i++) {
      const p = payments[i];

      if (!p.legacyId) errors.push(`payments[${i}]: missing legacyId`);
      if (!p.legacyOrderId) errors.push(`payments[${i}]: missing legacyOrderId`);
      if (!orderIdMap.has(p.legacyOrderId)) {
        errors.push(`payments[${i}]: order ${p.legacyOrderId} not in ID map`);
      }
      if (p.amount < 0) errors.push(`payments[${i}]: negative amount ${p.amount}`);
      if (p.amount === 0) warnings.push(`payments[${i}]: zero amount`);
    }

    return {
      valid: errors.length === 0,
      errors,
      warnings,
      summary: {
        total: payments.length,
        totalAmount: payments.reduce((sum, p) => sum + p.amount, 0),
        resolvableOrders: payments.filter((p) => orderIdMap.has(p.legacyOrderId)).length,
        unresolvableOrders: payments.filter((p) => !orderIdMap.has(p.legacyOrderId)).length,
      },
    };
  }

  /**
   * Post-migration reconciliation: compares migrated data against legacy source data.
   */
  async reconcile(
    legacyUsers: LegacyUserDto[],
    legacyOrders: LegacyOrderDto[],
    legacyPayments: LegacyPaymentDto[],
  ): Promise<ReconciliationResult> {
    const userIdMap = await this.loadIdMap(MigrationEntityType.USER);
    const orderIdMap = await this.loadIdMap(MigrationEntityType.ORDER);
    const paymentIdMap = await this.loadIdMap(MigrationEntityType.PAYMENT);

    // Users
    let usersMissing = 0;
    for (const u of legacyUsers) {
      if (!userIdMap.has(u.legacyId)) usersMissing++;
    }

    // Orders
    let ordersMissing = 0;
    const discrepancies: Array<{ legacyOrderId: string; field: string; expected: number; actual: number }> = [];
    let legacyTotalOrderValue = 0;
    let migratedTotalOrderValue = 0;

    for (const o of legacyOrders) {
      legacyTotalOrderValue += o.totalAmount;
      const newOrderId = orderIdMap.get(o.legacyId);
      if (!newOrderId) {
        ordersMissing++;
        continue;
      }
      const migratedOrder = await this.prisma.order.findUnique({
        where: { id: newOrderId },
        select: { totalAmount: true },
      });
      if (migratedOrder) {
        migratedTotalOrderValue += migratedOrder.totalAmount;
        if (Math.abs(migratedOrder.totalAmount - o.totalAmount) > 0.01) {
          discrepancies.push({
            legacyOrderId: o.legacyId,
            field: 'totalAmount',
            expected: o.totalAmount,
            actual: migratedOrder.totalAmount,
          });
        }
      }
    }

    // Payments
    let paymentsMissing = 0;
    let legacyTotalPayments = 0;
    let migratedTotalPayments = 0;

    for (const p of legacyPayments) {
      legacyTotalPayments += p.amount;
      const newPaymentId = paymentIdMap.get(p.legacyId);
      if (!newPaymentId) {
        paymentsMissing++;
        continue;
      }
      const migratedPayment = await this.prisma.payment.findUnique({
        where: { id: newPaymentId },
        select: { amount: true },
      });
      if (migratedPayment) {
        migratedTotalPayments += migratedPayment.amount;
        if (Math.abs(migratedPayment.amount - p.amount) > 0.01) {
          discrepancies.push({
            legacyOrderId: p.legacyOrderId,
            field: `payment.amount (${p.legacyId})`,
            expected: p.amount,
            actual: migratedPayment.amount,
          });
        }
      }
    }

    const valid =
      usersMissing === 0 &&
      ordersMissing === 0 &&
      paymentsMissing === 0 &&
      discrepancies.length === 0 &&
      Math.abs(legacyTotalOrderValue - migratedTotalOrderValue) < 0.01 &&
      Math.abs(legacyTotalPayments - migratedTotalPayments) < 0.01;

    return {
      usersMatched: userIdMap.size,
      usersMissing,
      ordersMatched: orderIdMap.size - ordersMissing,
      ordersMissing,
      paymentsMatched: paymentIdMap.size - paymentsMissing,
      paymentsMissing,
      financialSummary: {
        legacyTotalOrderValue,
        migratedTotalOrderValue,
        legacyTotalPayments,
        migratedTotalPayments,
        discrepancies,
      },
      valid,
    };
  }

  // ════════════════════════════════════════════════════════
  // STEP 7 & 8: ROLLBACK
  // ════════════════════════════════════════════════════════

  /**
   * Rollback a specific migration run.
   * Deletes all records created during that run using the audit trail.
   */
  async rollbackRun(runId: string): Promise<{ rolledBack: number; errors: string[] }> {
    const run = await this.prisma.migrationRun.findUnique({
      where: { id: runId },
    });
    if (!run) throw new BadRequestException('Migration run not found');
    if (run.status === MigrationStatus.ROLLED_BACK) {
      throw new ConflictException('Migration run already rolled back');
    }

    this.logger.warn(`Rolling back migration run ${runId} (${run.entityType})`);

    const records = await this.prisma.migrationRecord.findMany({
      where: { runId, status: MigrationRecordStatus.SUCCESS },
      select: { newId: true, entityType: true, legacyId: true },
    });

    let rolledBack = 0;
    const errors: string[] = [];

    // Rollback in reverse dependency order: Payments → Orders → Users
    const sorted = this.sortForRollback(records, run.entityType);

    for (const record of sorted) {
      if (!record.newId) continue;

      try {
        await this.deleteEntity(record.entityType, record.newId);

        // Clean up ID map
        await this.prisma.migrationIdMap.deleteMany({
          where: {
            entityType: record.entityType,
            legacyId: record.legacyId,
          },
        });

        rolledBack++;
      } catch (error) {
        const errMsg = error instanceof Error ? error.message : String(error);
        errors.push(`Failed to rollback ${record.entityType}:${record.legacyId}: ${errMsg}`);
      }
    }

    // Mark run as rolled back
    await this.prisma.migrationRun.update({
      where: { id: runId },
      data: {
        status: MigrationStatus.ROLLED_BACK,
        rolledBackAt: new Date(),
      },
    });

    // Clean up migration records
    await this.prisma.migrationRecord.deleteMany({ where: { runId } });

    this.logger.warn(`Rollback complete: ${rolledBack} records rolled back, ${errors.length} errors`);
    return { rolledBack, errors };
  }

  /**
   * Rollback ALL migration data (nuclear option — use with caution).
   * Requires explicit confirmation flag.
   */
  async rollbackAll(confirm: boolean): Promise<{ runs: number; records: number }> {
    if (!confirm) throw new BadRequestException('Must confirm full rollback with confirm=true');

    this.logger.warn('FULL MIGRATION ROLLBACK initiated');

    const runs = await this.prisma.migrationRun.findMany({
      where: { status: { not: MigrationStatus.ROLLED_BACK } },
      orderBy: { startedAt: 'desc' },
    });

    // Rollback in reverse chronological order
    for (const run of runs) {
      await this.rollbackRun(run.id).catch((e) => {
        this.logger.error(`Rollback failed for run ${run.id}: ${e.message}`);
      });
    }

    const totalRuns = runs.length;
    const remainingRecords = await this.prisma.migrationRecord.count();

    return { runs: totalRuns, records: remainingRecords };
  }

  // ════════════════════════════════════════════════════════
  // STEP 9: STATUS & REPORTING
  // ════════════════════════════════════════════════════════

  async getMigrationStatus(): Promise<{
    runs: any[];
    totals: Record<string, { success: number; failed: number; skipped: number }>;
    idMapCounts: Record<string, number>;
  }> {
    const runs = await this.prisma.migrationRun.findMany({
      orderBy: { startedAt: 'desc' },
      take: 50,
      select: {
        id: true,
        entityType: true,
        status: true,
        totalRecords: true,
        successCount: true,
        failedCount: true,
        skippedCount: true,
        startedAt: true,
        completedAt: true,
        rolledBackAt: true,
      },
    });

    // Aggregate totals per entity type
    const totals: Record<string, { success: number; failed: number; skipped: number }> = {};
    for (const run of runs) {
      if (run.status === MigrationStatus.ROLLED_BACK) continue;
      if (!totals[run.entityType]) totals[run.entityType] = { success: 0, failed: 0, skipped: 0 };
      totals[run.entityType].success += run.successCount;
      totals[run.entityType].failed += run.failedCount;
      totals[run.entityType].skipped += run.skippedCount;
    }

    // ID map counts
    const idMapCounts: Record<string, number> = {};
    for (const entityType of Object.values(MigrationEntityType)) {
      idMapCounts[entityType] = await this.prisma.migrationIdMap.count({
        where: { entityType },
      });
    }

    return { runs, totals, idMapCounts };
  }

  async getRunDetails(runId: string) {
    const run = await this.prisma.migrationRun.findUnique({
      where: { id: runId },
      include: {
        records: {
          orderBy: { createdAt: 'asc' },
          take: 500,
        },
      },
    });
    if (!run) throw new BadRequestException('Migration run not found');
    return run;
  }

  async getFailedRecords(entityType?: MigrationEntityType) {
    return this.prisma.migrationRecord.findMany({
      where: {
        status: MigrationRecordStatus.FAILED,
        ...(entityType ? { entityType } : {}),
      },
      orderBy: { createdAt: 'desc' },
      take: 200,
    });
  }

  // ════════════════════════════════════════════════════════
  // HELPERS
  // ════════════════════════════════════════════════════════

  /**
   * Deduplicate users by phone number. Last occurrence wins (newest data).
   */
  private deduplicateUsersByPhone(users: LegacyUserDto[]): LegacyUserDto[] {
    const phoneMap = new Map<string, LegacyUserDto>();
    for (const user of users) {
      phoneMap.set(user.phone, user);
    }
    return [...phoneMap.values()];
  }

  private mapUserStatus(status?: string): UserStatus {
    switch (status) {
      case 'APPROVED': return UserStatus.APPROVED;
      case 'REJECTED': return UserStatus.REJECTED;
      case 'BLOCKED': return UserStatus.BLOCKED;
      default: return UserStatus.PENDING;
    }
  }

  private mapOrderStatus(status?: string): OrderStatus {
    switch (status) {
      case 'ACCEPTED': return OrderStatus.ACCEPTED;
      case 'SHIPPED': return OrderStatus.SHIPPED;
      case 'OUT_FOR_DELIVERY': return OrderStatus.OUT_FOR_DELIVERY;
      case 'DELIVERED': return OrderStatus.DELIVERED;
      case 'CANCELLED': return OrderStatus.CANCELLED;
      default: return OrderStatus.PLACED;
    }
  }

  private mapPaymentStatus(status?: string): PaymentStatus {
    switch (status) {
      case 'PARTIAL': return PaymentStatus.PARTIAL;
      case 'SUCCESS': return PaymentStatus.SUCCESS;
      case 'FAILED': return PaymentStatus.FAILED;
      default: return PaymentStatus.PENDING;
    }
  }

  private mapPaymentMethod(method?: string): PaymentMethod {
    switch (method) {
      case 'BANK_TRANSFER': return PaymentMethod.BANK_TRANSFER;
      case 'UPI': return PaymentMethod.UPI;
      case 'COD': return PaymentMethod.COD;
      case 'PARTIAL': return PaymentMethod.PARTIAL;
      case 'CREDIT': return PaymentMethod.CREDIT;
      default: return PaymentMethod.COD;
    }
  }

  private mapVerificationStatus(status?: string): PaymentVerificationStatus {
    switch (status) {
      case 'CONFIRMED': return PaymentVerificationStatus.CONFIRMED;
      case 'REJECTED': return PaymentVerificationStatus.REJECTED;
      default: return PaymentVerificationStatus.PENDING;
    }
  }

  /**
   * Load all legacy→new ID mappings for a given entity type into a Map for O(1) lookups.
   */
  private async loadIdMap(entityType: MigrationEntityType): Promise<Map<string, string>> {
    const records = await this.prisma.migrationIdMap.findMany({
      where: { entityType },
      select: { legacyId: true, newId: true },
    });
    return new Map(records.map((r) => [r.legacyId, r.newId]));
  }

  /**
   * Load product externalId → product.id map.
   * Products use externalId (not migration ID map) for legacy reference.
   */
  private async loadProductExternalIdMap(): Promise<Map<string, string>> {
    const products = await this.prisma.product.findMany({
      where: { externalId: { not: null } },
      select: { id: true, externalId: true },
    });
    return new Map(products.map((p) => [p.externalId!, p.id]));
  }

  private sortForRollback(
    records: Array<{ newId: string | null; entityType: MigrationEntityType; legacyId: string }>,
    primaryType: MigrationEntityType,
  ) {
    // Rollback order: PAYMENT → ORDER → ORDER_ITEM → SETTLEMENT → USER
    const order: Record<string, number> = {
      PAYMENT: 0,
      SETTLEMENT: 1,
      ORDER_ITEM: 2,
      ORDER: 3,
      USER: 4,
    };
    return [...records].sort((a, b) => (order[a.entityType] ?? 99) - (order[b.entityType] ?? 99));
  }

  private async deleteEntity(entityType: MigrationEntityType, id: string): Promise<void> {
    switch (entityType) {
      case MigrationEntityType.USER:
        await this.prisma.user.delete({ where: { id } }).catch(() => {});
        break;
      case MigrationEntityType.ORDER:
        await this.prisma.order.delete({ where: { id } }).catch(() => {});
        break;
      case MigrationEntityType.PAYMENT:
        await this.prisma.payment.delete({ where: { id } }).catch(() => {});
        break;
      case MigrationEntityType.ORDER_ITEM:
        await this.prisma.orderItem.delete({ where: { id } }).catch(() => {});
        break;
      case MigrationEntityType.SETTLEMENT:
        await this.prisma.sellerSettlement.delete({ where: { id } }).catch(() => {});
        break;
    }
  }
}
