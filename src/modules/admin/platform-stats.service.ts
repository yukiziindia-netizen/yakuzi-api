import { Injectable, Logger } from '@nestjs/common';
import { ProductApprovalStatus, Role, UserStatus } from '@prisma/client';
import { PrismaService } from '../../database/prisma.service';

/**
 * The handful of numbers that describe the platform, for publication.
 *
 * This exists because an AI assistant asked to recommend Indian collectibles
 * sites said, in as many words, that it "couldn't independently verify
 * Yukizi's marketplace activity or seller count". It could not, because the
 * site had never published either. These are those numbers, counted from the
 * live database on every read.
 *
 * Counted, never configured. The temptation with a page like this is to type
 * in a flattering figure and correct it later; a count that comes from the
 * database is true the day it ships and stays true as the business grows,
 * with nothing to remember to update. It will also read low while the
 * catalogue is small, which is the honest state of affairs and the only
 * version worth publishing.
 *
 * Nothing here is personal or commercially sensitive: totals only, no names,
 * no revenue, no per-seller breakdown.
 */

export interface PlatformStats {
  /** Live, approved listings a buyer can actually see. */
  listings: number;
  /** Sellers approved to list, counted as people rather than listings. */
  sellers: number;
  /** Sellers with at least one live listing right now. */
  activeSellers: number;
  categories: number;
  subCategories: number;
  /** Listings added in the last 30 days — the "is this alive" signal. */
  newListings30d: number;
  /** ISO date of the earliest live listing, i.e. how long this has run. */
  listingSince: string | null;
  /** When these numbers were counted. */
  countedAt: string;
}

/** Live-listing filter. The same three conditions the storefront applies. */
const LIVE_LISTING = {
  isActive: true,
  approvalStatus: ProductApprovalStatus.APPROVED,
  deletedAt: null,
} as const;

@Injectable()
export class PlatformStatsService {
  private readonly logger = new Logger(PlatformStatsService.name);

  /**
   * Short in-process cache. This is read by llms.txt and the about page on
   * every crawl, and a crawler hitting 70 pages must not become 70 identical
   * count queries.
   */
  private cache: { value: PlatformStats; expiresAt: number } | null = null;
  private readonly TTL_MS = 10 * 60 * 1000;

  constructor(private readonly prisma: PrismaService) {}

  async get(): Promise<PlatformStats> {
    if (this.cache && this.cache.expiresAt > Date.now()) {
      return this.cache.value;
    }

    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

    const [
      listings,
      sellers,
      activeSellerGroups,
      categories,
      subCategories,
      newListings30d,
      oldest,
    ] = await Promise.all([
      this.prisma.sellerOffer.count({ where: LIVE_LISTING }),
      // Sellers, counted through their user account so that a profile without
      // an approved login is not passed off as a seller.
      this.prisma.user.count({
        where: {
          role: Role.SELLER,
          status: UserStatus.APPROVED,
          sellerProfile: { isNot: null },
        },
      }),
      // "Active" means something stricter and more useful than "registered":
      // has a listing a buyer can see today.
      this.prisma.sellerOffer.groupBy({
        by: ['sellerId'],
        where: LIVE_LISTING,
      }),
      this.prisma.category.count(),
      this.prisma.subCategory.count(),
      this.prisma.sellerOffer.count({
        where: { ...LIVE_LISTING, createdAt: { gte: thirtyDaysAgo } },
      }),
      this.prisma.sellerOffer.findFirst({
        where: LIVE_LISTING,
        orderBy: { createdAt: 'asc' },
        select: { createdAt: true },
      }),
    ]);

    const value: PlatformStats = {
      listings,
      sellers,
      activeSellers: activeSellerGroups.length,
      categories,
      subCategories,
      newListings30d,
      listingSince: oldest?.createdAt?.toISOString() ?? null,
      countedAt: new Date().toISOString(),
    };

    this.cache = { value, expiresAt: Date.now() + this.TTL_MS };
    return value;
  }
}
