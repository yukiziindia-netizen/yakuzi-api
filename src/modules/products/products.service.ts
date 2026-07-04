import {
  Injectable,
  NotFoundException,
  ForbiddenException,
  BadRequestException,
  Logger,
} from '@nestjs/common';
import { Prisma, ProductApprovalStatus } from '@prisma/client';
import { PrismaService } from '../../database/prisma.service';
import { InventoryService } from './services/inventory.service';
import { SearchIndexService } from './services/search-index.service';
import { AnalyticsService } from './services/analytics.service';
import { CreateProductDto } from './dto/create-product.dto';
import { UpdateProductDto } from './dto/update-product.dto';
import { QueryProductDto } from './dto/query-product.dto';
import { CreateProductRequestDto } from './dto/create-product-request.dto';
import { BulkCreateProductDto } from './dto/bulk-create-product.dto';

@Injectable()
export class ProductsService {
  private readonly logger = new Logger(ProductsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly inventoryService: InventoryService,
    private readonly searchIndexService: SearchIndexService,
    private readonly analyticsService: AnalyticsService,
  ) {}

  // ──────────────────────────────────────────────
  // SELLER ENDPOINTS
  // ──────────────────────────────────────────────

  // ──────────────────────────────────────────────
  // NORMALIZATION HELPERS
  // ──────────────────────────────────────────────

  private normalizeString(value: string | undefined | null): string {
    return (value ?? '').trim();
  }

  private generateSlug(name: string): string {
    return name
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9\s-]/g, '')
      .replace(/\s+/g, '-')
      .replace(/-+/g, '-');
  }

  private normalizeDto(dto: CreateProductDto): CreateProductDto {
    return {
      ...dto,
      name: this.normalizeString(dto.name),
      manufacturer: this.normalizeString(dto.manufacturer),

      description: dto.description
        ? this.normalizeString(dto.description)
        : undefined,
      slug: dto.slug
        ? dto.slug.trim().toLowerCase()
        : this.generateSlug(dto.name),
      externalId: dto.externalId ? dto.externalId.trim() : undefined,
      variantId: dto.variantId ? dto.variantId.trim() : undefined,
    };
  }

  /**
   * Create a product with default batch, search index, and analytics.
   * Supports images, discount fields, externalId (idempotent upsert), and migration mode.
   */
  async create(userId: string, dto: CreateProductDto) {
    const normalized = this.normalizeDto(dto);

    const seller = await this.prisma.sellerProfile.findUnique({
      where: { userId },
    });
    if (!seller) {
      throw new ForbiddenException('Seller profile not found');
    }

    const [category, subCategory] = await Promise.all([
      this.prisma.category.findUnique({ where: { id: normalized.categoryId } }),
      this.prisma.subCategory.findUnique({
        where: { id: normalized.subCategoryId },
      }),
    ]);
    if (!category) throw new NotFoundException('Category not found');
    if (!subCategory) throw new NotFoundException('Sub-category not found');

    // Idempotent upsert: if externalId is provided and exists, update instead
    if (normalized.externalId) {
      const existing = await this.prisma.sellerOffer.findUnique({
        where: { externalId: normalized.externalId },
      });
      if (existing) {
        this.logger.log(
          `Upsert: product with externalId ${normalized.externalId} exists, updating`,
        );
        return this.upsertExistingProduct(
          existing.id,
          seller.id,
          normalized,
          category,
          subCategory,
        );
      }
    }

    // Also check slug uniqueness for upsert
    if (normalized.slug) {
      const existingBySlug = await this.prisma.sellerOffer.findFirst({
        where: { slug: normalized.slug },
      });
      if (existingBySlug) {
        if (normalized.externalId || normalized.isMigration) {
          this.logger.log(
            `Upsert: product with slug ${normalized.slug} exists, updating`,
          );
          return this.upsertExistingProduct(
            existingBySlug.id,
            seller.id,
            normalized,
            category,
            subCategory,
          );
        }
        // Allow duplicate slugs for seller-specific listings
      }
    }

    const masterProductId = dto.masterProductId;
    let catalogProduct: any = null;
    if (masterProductId) {
      catalogProduct = await this.prisma.catalogProduct.findUnique({
        where: { id: masterProductId },
        include: { productVariants: true },
      });
    }

    if (!catalogProduct && !normalized.variantId) {
      catalogProduct = await this.prisma.catalogProduct.findFirst({
        where: {
          name: { equals: normalized.name, mode: 'insensitive' },
          manufacturer: {
            equals: normalized.manufacturer,
            mode: 'insensitive',
          },
          deletedAt: null,
        },
        include: { productVariants: true },
      });
    }

    const isFromMaster = !!catalogProduct;

    // Handle multiple variants
    if (dto.variants && dto.variants.length > 0) {
      const createdOffers: any[] = [];
      for (const v of dto.variants) {
        // Find matching variant if from master
        let matchedVariantId = undefined;
        if (catalogProduct) {
          const matched = catalogProduct.productVariants.find(
            (pv) => pv.name === v.name,
          );
          if (matched) matchedVariantId = matched.id;
        }

        // If from master but no match, could be a new variant not in master, or just a seller override
        const offerName = `${normalized.name} - ${v.name}`;
        const slug =
          this.generateSlug(offerName) +
          '-' +
          Math.random().toString(36).substring(2, 6);

        const existingProduct = await this.prisma.sellerOffer.findFirst({
          where: { sellerId: seller.id, name: offerName, deletedAt: null },
        });

        let product;
        if (existingProduct) {
          product = await this.prisma.sellerOffer.update({
            where: { id: existingProduct.id },
            data: {
              category: { connect: { id: normalized.categoryId } },
              subCategory: { connect: { id: normalized.subCategoryId } },
              manufacturer: normalized.manufacturer,
              description: normalized.description,
              mrp: v.price > 0 ? v.price : normalized.mrp,
              gstPercent: normalized.gstPercent,
              isTaxIncluded: normalized.isTaxIncluded ?? false,
              shippingCharges: normalized.shippingCharges ?? 0,
              minimumOrderQuantity: normalized.minimumOrderQuantity ?? 1,
              maximumOrderQuantity: normalized.maximumOrderQuantity,
              discountType: normalized.discountType,
              discountMeta: normalized.discountMeta ?? undefined,
              deliveryText: normalized.deliveryText,
            },
            include: { category: true, subCategory: true },
          });

          await this.inventoryService.updateDefaultBatch(
            product.id,
            v.available > 0 ? v.available : normalized.stock,
            normalized.expiryDate,
          );
        } else {
          const productData: Prisma.SellerOfferCreateInput = {
            seller: { connect: { id: seller.id } },
            category: { connect: { id: normalized.categoryId } },
            subCategory: { connect: { id: normalized.subCategoryId } },
            variant: matchedVariantId
              ? { connect: { id: matchedVariantId } }
              : undefined,
            name: offerName,
            slug: slug,
            externalId: normalized.externalId
              ? `${normalized.externalId}-${v.name}`
              : undefined,
            manufacturer: normalized.manufacturer,
            description: normalized.description,
            mrp: v.price > 0 ? v.price : normalized.mrp,
            gstPercent: normalized.gstPercent,
            isTaxIncluded: normalized.isTaxIncluded ?? false,
            shippingCharges: normalized.shippingCharges ?? 0,
            minimumOrderQuantity: normalized.minimumOrderQuantity ?? 1,
            maximumOrderQuantity: normalized.maximumOrderQuantity,
            discountType: normalized.discountType,
            discountMeta: normalized.discountMeta ?? undefined,
            deliveryText: normalized.deliveryText,
            approvalStatus: isFromMaster
              ? ProductApprovalStatus.APPROVED
              : ProductApprovalStatus.PENDING,
            isActive: isFromMaster ? true : false,
          };

          product = await this.prisma.sellerOffer.create({
            data: productData,
            include: { category: true, subCategory: true },
          });

          await this.inventoryService.createDefaultBatch(
            product.id,
            v.available > 0 ? v.available : normalized.stock,
            normalized.expiryDate,
          );
        }

        this.searchIndexService.upsert(product.id, {
          name: product.name,
          manufacturer: product.manufacturer,
          categoryName: category.name,
          subCategoryName: subCategory.name,
        });

        this.analyticsService.initialise(product.id);
        this.logger.log(
          `Product variant created: ${product.id} by seller ${seller.id}`,
        );
        createdOffers.push(product);
      }

      if (catalogProduct) {
        await this.prisma.catalogProduct
          .update({
            where: { id: catalogProduct.id },
            data: { updatedAt: new Date() },
          })
          .catch((err) =>
            this.logger.warn(`Failed to touch MasterProduct: ${err.message}`),
          );
      }

      return {
        ...createdOffers[0],
        images: normalized.images?.length ? [] : [],
        stock:
          dto.variants[0]?.available > 0
            ? dto.variants[0].available
            : normalized.stock,
        expiryDate: normalized.expiryDate,
      };
    }

    // Default flow: single product without specific variants array
    let variantId = normalized.variantId;
    if (
      !variantId &&
      catalogProduct &&
      catalogProduct.productVariants.length > 0
    ) {
      variantId = catalogProduct.productVariants[0].id;
    }

    const existingProduct = await this.prisma.sellerOffer.findFirst({
      where: { sellerId: seller.id, name: normalized.name, deletedAt: null },
    });

    let product;
    if (existingProduct) {
      product = await this.prisma.sellerOffer.update({
        where: { id: existingProduct.id },
        data: {
          category: { connect: { id: normalized.categoryId } },
          subCategory: { connect: { id: normalized.subCategoryId } },
          manufacturer: normalized.manufacturer,
          description: normalized.description,
          mrp: normalized.mrp,
          gstPercent: normalized.gstPercent,
          isTaxIncluded: normalized.isTaxIncluded ?? false,
          shippingCharges: normalized.shippingCharges ?? 0,
          minimumOrderQuantity: normalized.minimumOrderQuantity ?? 1,
          maximumOrderQuantity: normalized.maximumOrderQuantity,
          discountType: normalized.discountType,
          discountMeta: normalized.discountMeta ?? undefined,
          deliveryText: normalized.deliveryText,
        },
        include: { category: true, subCategory: true },
      });
      await this.inventoryService.updateDefaultBatch(
        product.id,
        normalized.stock,
        normalized.expiryDate,
      );
    } else {
      const productData: Prisma.SellerOfferCreateInput = {
        seller: { connect: { id: seller.id } },
        category: { connect: { id: normalized.categoryId } },
        subCategory: { connect: { id: normalized.subCategoryId } },
        variant: variantId ? { connect: { id: variantId } } : undefined,
        name: normalized.name,
        slug: normalized.slug,
        externalId: normalized.externalId,
        manufacturer: normalized.manufacturer,
        description: normalized.description,
        mrp: normalized.mrp,
        gstPercent: normalized.gstPercent,
        isTaxIncluded: normalized.isTaxIncluded ?? false,
        minimumOrderQuantity: normalized.minimumOrderQuantity ?? 1,
        maximumOrderQuantity: normalized.maximumOrderQuantity,
        discountType: normalized.discountType,
        discountMeta: normalized.discountMeta ?? undefined,
        deliveryText: normalized.deliveryText,
        approvalStatus: isFromMaster
          ? ProductApprovalStatus.APPROVED
          : ProductApprovalStatus.PENDING,
        isActive: isFromMaster ? true : false, // Auto-approve if from master catalog
      };

      product = await this.prisma.sellerOffer.create({
        data: productData,
        include: {
          category: true,
          subCategory: true,
        },
      });

      await this.inventoryService.createDefaultBatch(
        product.id,
        normalized.stock,
        normalized.expiryDate,
      );
    }

    // Create images if provided
    if (normalized.images && normalized.images.length > 0) {
      // await this.prisma.catalogProductImage.createMany
    }

    this.searchIndexService.upsert(product.id, {
      name: product.name,
      manufacturer: product.manufacturer,

      categoryName: category.name,
      subCategoryName: subCategory.name,
    });

    this.analyticsService.initialise(product.id);

    this.logger.log(`Product created: ${product.id} by seller ${seller.id}`);

    // Touch the master product to reflect new listing activity
    if (catalogProduct) {
      // Notify waitlisted users
      await this.notifyWaitlistedUsers(catalogProduct.id).catch((err) => {
        this.logger.error(
          `Failed to notify waitlisted users for product ${catalogProduct.id}: ${err.message}`,
        );
      });

      await this.prisma.catalogProduct
        .update({
          where: { id: catalogProduct.id },
          data: { updatedAt: new Date() },
        })
        .catch((err) =>
          this.logger.warn(`Failed to touch MasterProduct: ${err.message}`),
        );
    }

    const batch = await this.prisma.productBatch.findFirst({
      where: { sellerOfferId: product.id, batchNumber: 'DEFAULT' },
    });

    const images = normalized.images?.length ? [] : [];

    return {
      ...product,
      images,
      stock: batch?.stock ?? 0,
      expiryDate: batch?.expiryDate ?? null,
    };
  }

  /**
   * Upsert an existing product during migration/idempotent creation.
   */
  private async upsertExistingProduct(
    productId: string,
    sellerId: string,
    dto: CreateProductDto,
    category: { name: string },
    subCategory: { name: string },
  ) {
    const updated = await this.prisma.sellerOffer.update({
      where: { id: productId },
      data: {
        seller: { connect: { id: sellerId } },
        category: { connect: { id: dto.categoryId } },
        subCategory: { connect: { id: dto.subCategoryId } },
        name: dto.name,
        slug: dto.slug,
        manufacturer: dto.manufacturer,

        description: dto.description,
        mrp: dto.mrp,
        gstPercent: dto.gstPercent,
        isTaxIncluded: dto.isTaxIncluded,
        ...(dto.shippingCharges !== undefined && { shippingCharges: dto.shippingCharges }),
        minimumOrderQuantity: dto.minimumOrderQuantity ?? 1,
        maximumOrderQuantity: dto.maximumOrderQuantity,
        discountType: dto.discountType,
        discountMeta: dto.discountMeta ?? undefined,
        deliveryText: dto.deliveryText,
        isActive: true,
        deletedAt: null,
      },
      include: {
        category: true,
        subCategory: true,
      },
    });

    // Replace images
    if (dto.images && dto.images.length > 0) {
      // await this.prisma.catalogProductImage.deleteMany
      // await this.prisma.catalogProductImage.createMany
    }

    await this.inventoryService.updateDefaultBatch(
      productId,
      dto.stock,
      dto.expiryDate,
    );

    this.searchIndexService.upsert(productId, {
      name: updated.name,
      manufacturer: updated.manufacturer,

      categoryName: category.name,
      subCategoryName: subCategory.name,
    });

    const batch = await this.prisma.productBatch.findFirst({
      where: { sellerOfferId: productId, batchNumber: 'DEFAULT' },
    });

    const images = [];

    this.logger.log(`Product upserted: ${productId}`);

    // Touch the master product to reflect new listing activity
    if (updated.variantId) {
      await this.prisma.catalogProduct
        .update({
          where: { id: updated.variantId },
          data: { updatedAt: new Date() },
        })
        .catch((err) =>
          this.logger.warn(
            `Failed to touch MasterProduct ${updated.variantId}: ${err.message}`,
          ),
        );
    }

    return {
      ...updated,
      images,
      stock: batch?.stock ?? 0,
      expiryDate: batch?.expiryDate ?? null,
    };
  }

  /**
   * Bulk create products for migration. Processes each product individually
   * within a single flow, returning success/failure counts.
   */
  async bulkCreate(userId: string, dto: BulkCreateProductDto) {
    const results = {
      success: 0,
      failed: 0,
      errors: [] as { index: number; name: string; reason: string }[],
      created: [] as string[],
    };

    for (let i = 0; i < dto.products.length; i++) {
      try {
        const product = await this.create(userId, dto.products[i]);
        results.success++;
        results.created.push(product.id);
      } catch (error) {
        results.failed++;
        results.errors.push({
          index: i,
          name: dto.products[i]?.name ?? 'unknown',
          reason: error instanceof Error ? error.message : 'Unknown error',
        });
        this.logger.warn(
          `Bulk create failed at index ${i}: ${error instanceof Error ? error.message : error}`,
        );
      }
    }

    this.logger.log(
      `Bulk product creation: ${results.success} success, ${results.failed} failed out of ${dto.products.length}`,
    );
    return results;
  }

  /**
   * List products owned by the current seller.
   */
  async findOwn(userId: string, query: QueryProductDto) {
    const seller = await this.prisma.sellerProfile.findUnique({
      where: { userId },
    });

    if (!seller) {
      this.logger.warn(
        `Seller profile not found for user ${userId} during findOwn`,
      );
      return {
        products: [],
        meta: {
          total: 0,
          page: query.page || 1,
          limit: query.limit || 20,
          totalPages: 0,
        },
      };
    }

    const {
      page = 1,
      limit = 20,
      sortBy = 'createdAt',
      sortOrder = 'desc',
    } = query;
    const skip = (page - 1) * limit;

    const where: Prisma.SellerOfferWhereInput = {
      sellerId: seller.id,
      deletedAt: null,
    };

    if (query.search) {
      where.OR = [
        { name: { contains: query.search, mode: 'insensitive' } },
        { manufacturer: { contains: query.search, mode: 'insensitive' } },
        { id: { startsWith: query.search, mode: 'insensitive' } },
        { variant: { sku: { contains: query.search, mode: 'insensitive' } } },
      ];
    }

    if (query.status) {
      where.approvalStatus =
        query.status.toUpperCase() as ProductApprovalStatus;
    }

    // New Items (Created in last 30 days)
    if (query.isNew) {
      const thirtyDaysAgo = new Date();
      thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
      where.createdAt = { gte: thirtyDaysAgo };
    }

    // Discounted Items
    if (query.isDiscounted) {
      where.discountType = { not: null };
    }

    // Best Selling Items
    if (query.isBestSelling) {
      where.analytics = {
        orders: { gt: 0 },
      };
    }

    const [products, total] = await Promise.all([
      this.prisma.sellerOffer.findMany({
        where,
        include: {
          category: true,
          subCategory: true,
          batches: true,
          variant: true,
        },
        orderBy: { [sortBy]: sortOrder },
        skip,
        take: limit,
      }),
      this.prisma.sellerOffer.count({ where }),
    ]);

    return {
      products: products.map((p) => this.flattenProduct(p)),
      meta: {
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit),
      },
    };
  }

  /**
   * Update a product. Only the owning seller may update.
   * Supports images array (replaces existing) and discount fields.
   */
  async update(userId: string, productId: string, dto: UpdateProductDto) {
    const product = await this.findOwnProduct(userId, productId);

    const {
      stock,
      expiryDate,
      images,
      masterProductId,
      options,
      variants,
      extraFields,
      categoryId,
      subCategoryId,
      ...productData
    } = dto;

    // Trim strings
    if (productData.name) productData.name = productData.name.trim();
    if (productData.manufacturer)
      productData.manufacturer = productData.manufacturer.trim();
    if (productData.description)
      productData.description = productData.description.trim();

    const updateData: Prisma.SellerOfferUpdateInput = {
      ...productData,
      ...(categoryId ? { category: { connect: { id: categoryId } } } : {}),
      ...(subCategoryId
        ? { subCategory: { connect: { id: subCategoryId } } }
        : {}),
    };

    const updated = await this.prisma.sellerOffer.update({
      where: { id: product.id },
      data: updateData,
      include: {
        category: true,
        subCategory: true,
      },
    });

    // Replace images if provided
    if (images !== undefined) {
      // await this.prisma.catalogProductImage.deleteMany
      if (images.length > 0) {
        // await this.prisma.catalogProductImage.createMany
      }
    }

    if (stock !== undefined || expiryDate !== undefined) {
      await this.inventoryService.updateDefaultBatch(
        product.id,
        stock,
        expiryDate,
      );

      if (stock !== undefined && stock > 0) {
        const offerWithVariant = await this.prisma.sellerOffer.findUnique({
          where: { id: product.id },
          include: { variant: true },
        });
        const catalogProductId = offerWithVariant?.variant?.catalogProductId;

        if (catalogProductId) {
          await this.notifyWaitlistedUsers(catalogProductId).catch((err) => {
            this.logger.error(
              `Failed to notify waitlisted users for product ${catalogProductId}: ${err.message}`,
            );
          });
        }
      }
    }

    if (dto.name || dto.manufacturer || dto.categoryId || dto.subCategoryId) {
      this.searchIndexService.upsert(updated.id, {
        name: updated.name,
        manufacturer: updated.manufacturer,

        categoryName: updated.category.name,
        subCategoryName: updated.subCategory.name,
      });
    }

    this.logger.log(`Product updated: ${updated.id}`);

    const [batch] = await Promise.all([
      this.prisma.productBatch.findFirst({
        where: { sellerOfferId: updated.id, batchNumber: 'DEFAULT' },
      }),
    ]);
    const productImages = [];

    return {
      ...updated,
      images: productImages,
      stock: batch?.stock ?? 0,
      expiryDate: batch?.expiryDate ?? null,
    };
  }

  /**
   * Soft-delete a product. Only the owning seller may delete.
   */
  async softDelete(userId: string, productId: string) {
    const product = await this.findOwnProduct(userId, productId);

    await this.prisma.sellerOffer.update({
      where: { id: product.id },
      data: { deletedAt: new Date(), isActive: false },
    });

    this.logger.log(`Product soft-deleted: ${product.id}`);
    return { message: 'Product deleted successfully' };
  }

  // ──────────────────────────────────────────────
  // PUBLIC ENDPOINTS (Browsing)
  // ──────────────────────────────────────────────

  /**
   * Browse all master products with filtering & pagination.
   * This is the "Marketplace" view where unique items are shown once.
   */
  async findAll(query: QueryProductDto) {
    const {
      page = 1,
      limit = 20,
      sortBy = 'createdAt',
      sortOrder = 'desc',
    } = query;
    const skip = (page - 1) * limit;

    // Handle sortBy mapping
    const effectiveSortBy =
      sortBy === 'price' ? 'mrp' : sortBy === 'newest' ? 'updatedAt' : sortBy;

    const where: Prisma.CatalogProductWhereInput = {
      isActive: true,
      deletedAt: null,
    };

    const andConditions: Prisma.CatalogProductWhereInput[] = [];

    if (query.search) {
      andConditions.push({
        OR: [
          { name: { contains: query.search, mode: 'insensitive' } },
          { manufacturer: { contains: query.search, mode: 'insensitive' } },
        ],
      });
    }

    if (query.categoryId) andConditions.push({ categoryId: query.categoryId });
    if (query.subCategoryId)
      andConditions.push({ subCategoryId: query.subCategoryId });
    if (query.manufacturer) {
      andConditions.push({
        manufacturer: { contains: query.manufacturer, mode: 'insensitive' },
      });
    }

    // New Items (Only those having a new seller listing in last 30 days)
    if (query.isNew) {
      const thirtyDaysAgo = new Date();
      thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
      andConditions.push({
        productVariants: {
          some: {
            sellerOffers: {
              some: {
                isActive: true,
                deletedAt: null,
                createdAt: { gte: thirtyDaysAgo },
              },
            },
          },
        },
      });
    }

    // Combine filters that target the underlying seller products
    const productConditions: Prisma.SellerOfferWhereInput[] = [
      { isActive: true, deletedAt: null },
    ];

    if (query.isDiscounted) {
      productConditions.push({ discountType: { not: null } });
    }

    if (query.isBestSelling) {
      productConditions.push({ analytics: { orders: { gt: 0 } } });
    }

    if (query.minPrice !== undefined || query.maxPrice !== undefined) {
      productConditions.push({
        mrp: {
          ...(query.minPrice !== undefined
            ? { gte: Number(query.minPrice) }
            : {}),
          ...(query.maxPrice !== undefined
            ? { lte: Number(query.maxPrice) }
            : {}),
        },
      });
    }

    if (query.location && query.location !== 'All') {
      productConditions.push({ seller: { city: query.location } });
    }

    if (query.discountType && query.discountType !== 'All') {
      let mappedType: string | null = null;
      if (query.discountType === 'Upclom') mappedType = 'PTR_DISCOUNT';
      else if (query.discountType === 'Fuill')
        mappedType = 'SAME_PRODUCT_BONUS';
      else mappedType = query.discountType;

      productConditions.push({ discountType: mappedType as any });
    }

    if (query.discountRange && query.discountRange !== 'All') {
      // Since discount logic depends on various types (PTR, Bonus), we'll do a generic discount check
      productConditions.push({ discountType: { not: null } });
    }

    if (productConditions.length > 1) {
      andConditions.push({
        productVariants: {
          some: { sellerOffers: { some: { AND: productConditions } } },
        },
      });
    }

    if (andConditions.length > 0) {
      where.AND = andConditions;
    }

    const [masters, total] = await Promise.all([
      this.prisma.catalogProduct.findMany({
        where,
        include: {
          category: true,
          subCategory: true,
          images: { take: 1 },
          productVariants: {
            include: {
              sellerOffers: {
                where: { isActive: true, deletedAt: null },
                select: {
                  id: true,
                  mrp: true,
                  gstPercent: true,
                  discountType: true,
                  discountMeta: true,
                  deliveryText: true,
                  minimumOrderQuantity: true,
                },
                orderBy: { mrp: 'asc' },
                take: 1,
              },
            },
          },
        },
        orderBy: { [effectiveSortBy]: sortOrder },
        skip,
        take: limit,
      }),
      this.prisma.catalogProduct.count({ where }),
    ]);

    return {
      products: masters.map((m) => this.mapMasterToGrid(m)),
      meta: {
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit),
      },
    };
  }

  /**
   * Get a single Master Product with all its seller listings.
   * This provides the data for the "Compare Sellers" view.
   */
  async findOne(id: string) {
    // 1. First, check if 'id' is a specific Seller Listing (Product)
    const listing = await this.prisma.sellerOffer.findFirst({
      where: { id, deletedAt: null },
      include: {
        category: true,
        subCategory: true,
        batches: true,
        variant: true,
        seller: {
          select: {
            id: true,
            companyName: true,
            rating: true,
            city: true,
            state: true,
          },
        },
      },
    });

    if (listing) {
      this.logger.log(`findOne: Found specific listing ${id}`);
      if (listing.variant?.catalogProductId) {
        const master = await this.prisma.catalogProduct.findFirst({
          where: { id: listing.variant.catalogProductId, deletedAt: null },
          include: {
            category: true,
            subCategory: true,
            images: true,
            productVariants: {
              include: {
                sellerOffers: {
                  where: { deletedAt: null },
                  include: {
                    seller: {
                      select: {
                        id: true,
                        companyName: true,
                        rating: true,
                        city: true,
                        state: true,
                      },
                    },
                    batches: { orderBy: { expiryDate: 'asc' } },
                  },
                  orderBy: { mrp: 'asc' },
                },
              },
            },
          },
        });
        if (master) {
          this.analyticsService.recordView(master.id);
          return this.formatMasterDetail(master);
        }
      }
      return this.flattenProduct(listing as any);
    }

    // 2. Fallback: Check if 'id' is a Master Product (by ID or Slug)
    const master = await this.prisma.catalogProduct.findFirst({
      where: {
        OR: [{ id }, { slug: id }],
        deletedAt: null,
      },
      include: {
        category: true,
        subCategory: true,
        images: true,

        productVariants: {
          include: {
            sellerOffers: {
              where: { deletedAt: null },
              include: {
                seller: {
                  select: {
                    id: true,
                    companyName: true,
                    rating: true,
                    city: true,
                    state: true,
                  },
                },
                batches: { orderBy: { expiryDate: 'asc' } },
              },
              orderBy: { mrp: 'asc' },
            },
          },
        },
      },
    });

    if (!master) {
      throw new NotFoundException('Product not found');
    }

    // record analytics view for the master item
    this.analyticsService.recordView(master.id);

    return this.formatMasterDetail(master);
  }

  private calculateSellingPrice(
    mrp: number,
    gstPercent: number,
    discountType: string | null,
    discountMeta: any,
  ): number {
    const margins: Record<number, number> = {
      0: 18.12,
      5: 23.81,
      12: 28.67,
      18: 32.2,
    };
    const retailMargin = margins[gstPercent] || 0;
    const ptr = Math.round((mrp - (mrp * retailMargin) / 100) * 100) / 100;

    let finalPtr = ptr;
    let discountPercent = 0;

    if (
      discountType === 'PTR_DISCOUNT' ||
      discountType === 'PTR_PLUS_SAME_PRODUCT_BONUS' ||
      discountType === 'PTR_PLUS_DIFFERENT_PRODUCT_BONUS'
    ) {
      discountPercent = discountMeta?.discountPercent ?? 0;
      finalPtr = Math.round((ptr - (ptr * discountPercent) / 100) * 100) / 100;
    } else if (discountType === 'SPECIAL_PRICE') {
      finalPtr = discountMeta?.specialPrice ?? ptr;
    }

    const gstValue = Math.round(((finalPtr * gstPercent) / 100) * 100) / 100;
    const perPtrWithGst = Math.round((finalPtr + gstValue) * 100) / 100;

    return perPtrWithGst;
  }

  private getBestOffer(m: any) {
    const listings = (m.productVariants || []).flatMap(
      (v: any) => v.sellerOffers || [],
    );
    if (listings.length === 0) return null;

    let bestOffer: any = null;
    let minSellingPrice = Infinity;

    for (const l of listings) {
      const sellingPrice = this.calculateSellingPrice(
        l.mrp,
        l.gstPercent,
        l.discountType,
        l.discountMeta,
      );
      if (sellingPrice < minSellingPrice) {
        minSellingPrice = sellingPrice;
        bestOffer = {
          ...l,
          sellingPrice,
        };
      }
    }

    return bestOffer;
  }

  private mapMasterToGrid(m: any) {
    const listings = (m.productVariants || []).flatMap(
      (v: any) => v.sellerOffers || [],
    );
    const bestOffer = this.getBestOffer(m);
    const minPrice =
      listings.length > 0
        ? Math.min(...listings.map((l: any) => l.mrp))
        : m.mrp;
    const minMoq =
      listings.length > 0
        ? Math.min(...listings.map((l: any) => l.minimumOrderQuantity || 1))
        : 1;
    const bestListingId =
      listings.length > 0
        ? listings.reduce((prev: any, curr: any) =>
            prev.mrp < curr.mrp ? prev : curr,
          ).id
        : null;
    const hasSellers = listings.length > 0;

    return {
      id: m.id,
      name: m.name,
      slug: m.slug,
      manufacturer: m.manufacturer,

      mrp: bestOffer ? bestOffer.mrp : m.mrp,
      price: bestOffer ? bestOffer.sellingPrice : null,
      discountType: bestOffer ? bestOffer.discountType : null,
      discountMeta: bestOffer ? bestOffer.discountMeta : null,
      gstPercent: bestOffer ? bestOffer.gstPercent : null,

      moq: minMoq,
      bestListingId,
      hasSellers,
      sellerCount: listings.length,
      image: m.images?.[0]?.url || null,
      category: m.category,
      subCategory: m.subCategory,
      isYukiziChoice: m.isYukiziChoice || false,
      isBestSeller: m.isBestSeller || false,
      isAd: m.isAd || false,
      createdAt: m.createdAt,
      updatedAt: m.updatedAt,
    };
  }

  private formatMasterDetail(m: any) {
    const allListings = (m.productVariants || []).flatMap(
      (v: any) => v.sellerOffers || [],
    );
    const bestListing =
      allListings.length > 0
        ? allListings.reduce((prev: any, curr: any) =>
            prev.mrp < curr.mrp ? prev : curr,
          )
        : null;
    return {
      id: m.id,
      name: m.name,
      slug: m.slug,
      manufacturer: m.manufacturer,

      description: m.description,
      mrp: m.mrp,
      price: bestListing ? bestListing.mrp : m.mrp,
      discountType: bestListing?.discountType || null,
      discountMeta: bestListing?.discountMeta || null,
      deliveryText: bestListing?.deliveryText || null,
      gstPercent: m.gstPercent,
      images: m.images,
      category: m.category,
      subCategory: m.subCategory,
      therapeuticClass: m.therapeuticClass,
      sideEffects: m.sideEffects,
      directionsForUse: m.directionsForUse,
      safetyAdvice: m.safetyAdvice,
      packSize: m.packSize,
      storageAndHandling: m.storageAndHandling,
      isYukiziChoice: m.isYukiziChoice || false,
      isBestSeller: m.isBestSeller || false,
      isAd: m.isAd || false,
      // Group seller listings
      listings: (m.productVariants || []).flatMap((v: any) =>
        (v.sellerOffers || []).map((p: any) => {
          const batches = p.batches || [];
          const stock = batches.reduce(
            (sum: number, b: any) => sum + b.stock,
            0,
          );
          const sellingPrice = this.calculateSellingPrice(
            p.mrp,
            p.gstPercent,
            p.discountType,
            p.discountMeta,
          );
          return {
            id: p.id,
            price: sellingPrice,
            mrp: p.mrp,
            discountType: p.discountType,
            discountMeta: p.discountMeta,
            deliveryText: p.deliveryText,
            stock,
            expiryDate: batches.length > 0 ? batches[0].expiryDate : null,
            seller: p.seller,
            sellerName: p.seller?.companyName,
            images: p.images?.length > 0 ? p.images : m.images, // Fallback to master images
            moq: p.minimumOrderQuantity || 1,
            variantName: v.name,
          };
        }),
      ),
      options: Array.isArray(m.options)
        ? m.options.filter(
            (o: any) =>
              o && typeof o === 'object' && !Array.isArray(o) && o.name,
          )
        : [],
      variants: (m.productVariants || []).map((v: any) => {
        const offers = v.sellerOffers || [];
        const minPrice =
          offers.length > 0
            ? Math.min(...offers.map((o: any) => o.mrp))
            : v.options?.price || 0;
        const totalStock = offers.reduce(
          (sum: number, o: any) =>
            sum +
            (o.batches || []).reduce(
              (bsum: number, b: any) => bsum + b.stock,
              0,
            ),
          0,
        );
        return {
          id: v.id,
          name: v.name,
          price: minPrice.toString(),
          available:
            totalStock > 0
              ? totalStock.toString()
              : v.options?.available
                ? v.options.available.toString()
                : '0',
          image: v.options?.image || null,
          sku: v.sku || v.options?.sku || '',
          shippingCharges: v.options?.shippingCharges || 0,
        };
      }),
    };
  }

  /**
   * Get product name suggestions for autocomplete.
   * Supports 'product' (default) for available listings and 'master' for catalog items.
   */
  async getSuggestions(query: string, type: 'product' | 'master' = 'product') {
    if (!query || query.trim().length < 2) {
      return [];
    }

    const q = query.trim();
    const words = q.split(/\s+/).filter((w) => w.length > 0);

    const buildFilter = (words: string[]) => {
      return {
        AND: words.map((w) => ({
          OR: [
            { name: { contains: w, mode: 'insensitive' as Prisma.QueryMode } },
            {
              manufacturer: {
                contains: w,
                mode: 'insensitive' as Prisma.QueryMode,
              },
            },
          ],
        })),
      };
    };

    if (type === 'master') {
      const suggestions = await this.prisma.catalogProduct.findMany({
        where: {
          deletedAt: null,
          isActive: true,
          ...buildFilter(words),
        },
        select: {
          id: true,
          name: true,
          manufacturer: true,
          slug: true,
          sku: true,
          specifications: true,
          mrp: true,
          gstPercent: true,
          categoryId: true,
          subCategoryId: true,
        },
        take: 10,
        orderBy: { name: 'asc' },
      });

      return suggestions.map((s) => ({
        id: s.id,
        productName: s.name,
        companyName: s.manufacturer,
        slug: s.slug,
        sku: s.sku ?? undefined,
        specifications: s.specifications ?? undefined,
        mrp: s.mrp,
        gstPercent: s.gstPercent,
        categoryId: s.categoryId,
        subCategoryId: s.subCategoryId,
      }));
    }

    const products = await this.prisma.sellerOffer.findMany({
      where: {
        isActive: true,
        approvalStatus: ProductApprovalStatus.APPROVED,
        deletedAt: null,
        ...buildFilter(words),
      },
      select: {
        id: true,
        name: true,
        manufacturer: true,
        slug: true,
        mrp: true,
      },
      take: 10,
      orderBy: { name: 'asc' },
    });

    return products.map((p) => ({
      id: p.id,
      productName: p.name,
      companyName: p.manufacturer,
      slug: p.slug,
      mrp: p.mrp,
    }));
  }

  /**
   * List all categories (public).
   */
  async getCategories() {
    return this.prisma.category.findMany({
      include: { subCategories: true },
      orderBy: { name: 'asc' },
    });
  }

  async getFeatured(slot: any) {
    const featured = await this.prisma.marketingProduct.findMany({
      where: { slot, active: true },
      include: {
        catalogProduct: {
          include: {
            category: true,
            subCategory: true,
            productVariants: {
              include: {
                sellerOffers: {
                  include: {
                    batches: {
                      where: { stock: { gt: 0 } },
                      orderBy: { expiryDate: 'asc' },
                    },
                    seller: {
                      select: {
                        companyName: true,
                        city: true,
                        state: true,
                        rating: true,
                      },
                    },
                  },
                },
              },
            },
          },
        },
      },
      orderBy: { priority: 'desc' },
      take: 12, // limit to 12 featured products per slot
    });

    return featured.map((f) => this.flattenProduct(f.catalogProduct));
  }

  // ──────────────────────────────────────────────
  // HELPERS
  // ──────────────────────────────────────────────

  /**
   * Find a product owned by the current seller, or throw.
   */
  private async findOwnProduct(userId: string, productId: string) {
    const seller = await this.prisma.sellerProfile.findUnique({
      where: { userId },
    });
    if (!seller) {
      throw new ForbiddenException('Seller profile not found');
    }

    const product = await this.prisma.sellerOffer.findFirst({
      where: { id: productId, sellerId: seller.id, deletedAt: null },
    });
    if (!product) {
      throw new NotFoundException(
        'Product not found or you do not have permission',
      );
    }

    return product;
  }

  /**
   * Flatten batches into top-level stock/expiryDate for Phase-1 compatibility.
   */
  private flattenProduct(product: Record<string, any>) {
    const batches = (product.batches ?? []) as Array<{
      stock: number;
      expiryDate: Date;
    }>;

    const totalStock = batches.reduce((sum, b) => sum + b.stock, 0);
    const nearestExpiry = batches.length > 0 ? batches[0].expiryDate : null;

    // Standardize images as string array
    const images = (product.images ?? []).map((img: any) =>
      typeof img === 'string' ? img : (img.url ?? img),
    );

    // Standardize category name
    let categoryName = product.category;
    if (product.category && typeof product.category === 'object') {
      categoryName = product.category.name || product.category.id;
    }

    let price = product.price;
    let mrp = product.mrp;

    if (product.discountType !== undefined && !product.productVariants) {
      price = this.calculateSellingPrice(
        product.mrp,
        product.gstPercent || 0,
        product.discountType,
        product.discountMeta,
      );
      mrp = product.mrp;
    }

    const {
      batches: _batches,
      images: _images,
      category: _category,
      ...rest
    } = product;
    return {
      ...rest,
      category: categoryName,
      images,
      stock: totalStock,
      expiryDate: nearestExpiry,
    };
  }

  // ──────────────────────────────────────────────
  // PRODUCT REQUESTS
  // ──────────────────────────────────────────────

  async createRequest(userId: string, dto: CreateProductRequestDto) {
    const request = await (this.prisma as any).catalogProductRequest.create({
      data: {
        userId,
        productName:
          (dto as any).catalogProductName?.trim() ||
          (dto as any).productName?.trim(),
        manufacturer: dto.manufacturer?.trim(),
        description: dto.description?.trim(),
        status: 'PENDING',
      },
      include: {
        user: {
          select: {
            id: true,
            phone: true,
            sellerProfile: {
              select: { companyName: true },
            },
          },
        },
      },
    });

    this.logger.log(`Product request created: ${request.id} by user ${userId}`);
    return request;
  }

  async findAllRequests(
    query: {
      page?: number | string;
      limit?: number | string;
      status?: string;
      userId?: string;
      search?: string;
      dateFrom?: string;
      dateTo?: string;
    } = {},
  ) {
    const page = Number(query.page || 1);
    const limit = Number(query.limit || 20);
    const skip = (page - 1) * limit;

    const where: any = {};
    if (query.status) {
      where.status = query.status.toUpperCase();
    }
    if (query.userId) {
      where.userId = query.userId;
    }
    if (query.search) {
      where.OR = [
        { productName: { contains: query.search, mode: 'insensitive' } },
        { manufacturer: { contains: query.search, mode: 'insensitive' } },
      ];
    }

    if (query.dateFrom || query.dateTo) {
      where.createdAt = {
        ...(query.dateFrom ? { gte: new Date(query.dateFrom) } : {}),
        ...(query.dateTo ? { lte: new Date(query.dateTo) } : {}),
      };
    }

    if (query.dateFrom || query.dateTo) {
      where.createdAt = {
        ...(query.dateFrom ? { gte: new Date(query.dateFrom) } : {}),
        ...(query.dateTo ? { lte: new Date(query.dateTo) } : {}),
      };
    }

    const [requests, total] = await Promise.all([
      (this.prisma as any).catalogProductRequest.findMany({
        where,
        include: {
          user: {
            select: {
              id: true,
              phone: true,
              sellerProfile: {
                select: { companyName: true },
              },
              buyerProfile: {
                select: { legalName: true },
              },
            },
          },
        },
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
      }),
      (this.prisma as any).catalogProductRequest.count({ where }),
    ]);

    return {
      requests,
      meta: {
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit),
      },
    };
  }

  async updateRequestStatus(requestId: string, status: any) {
    const request = await (this.prisma as any).catalogProductRequest.findUnique(
      {
        where: { id: requestId },
      },
    );

    if (!request) {
      throw new NotFoundException('Product request not found');
    }

    return (this.prisma as any).catalogProductRequest.update({
      where: { id: requestId },
      data: { status },
    });
  }

  // WAITLIST FEATURE

  async addToWaitlist(userId: string, catalogProductId: string) {
    const product = await this.prisma.catalogProduct.findUnique({
      where: { id: catalogProductId },
    });
    if (!product) {
      throw new NotFoundException('Product not found');
    }

    const existing = await this.prisma.productWaitlist.findUnique({
      where: {
        userId_catalogProductId: {
          userId,
          catalogProductId,
        },
      },
    });

    if (existing) {
      return existing; // already in waitlist
    }

    return this.prisma.productWaitlist.create({
      data: {
        userId,
        catalogProductId,
      },
    });
  }

  async removeFromWaitlist(userId: string, catalogProductId: string) {
    const existing = await this.prisma.productWaitlist.findUnique({
      where: {
        userId_catalogProductId: {
          userId,
          catalogProductId,
        },
      },
    });

    if (!existing) {
      return { success: true };
    }

    await this.prisma.productWaitlist.delete({
      where: {
        id: existing.id,
      },
    });

    return { success: true };
  }

  async getMyWaitlist(userId: string) {
    return this.prisma.productWaitlist.findMany({
      where: { userId },
      include: {
        catalogProduct: {
          include: {
            images: true,
          },
        },
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  async notifyWaitlistedUsers(catalogProductId: string) {
    const waitlisted = await this.prisma.productWaitlist.findMany({
      where: { catalogProductId, isNotified: false },
      include: { catalogProduct: true },
    });

    if (waitlisted.length === 0) return;

    const notifications = waitlisted.map((w) => ({
      userId: w.userId,
      message: `The product ${w.catalogProduct.name} you were waiting for is now back in stock!`,
    }));

    await this.prisma.notification.createMany({
      data: notifications,
    });

    await this.prisma.productWaitlist.updateMany({
      where: { id: { in: waitlisted.map((w) => w.id) } },
      data: { isNotified: true },
    });
  }
}
