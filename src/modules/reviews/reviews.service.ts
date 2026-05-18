import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ConflictException,
  Logger,
} from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';
import { CreateReviewDto } from './dto/create-review.dto';

@Injectable()
export class ReviewsService {
  private readonly logger = new Logger(ReviewsService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Create a review. Only buyers who purchased the product may review it.
   * One review per user per product (enforced by @@unique([userId, productId])).
   */
  async createReview(userId: string, dto: CreateReviewDto) {
    const { productId, rating, comment } = dto;

    // Verify product exists
    const product = await this.prisma.product.findUnique({
      where: { id: productId },
    });

    if (!product) {
      throw new NotFoundException('Product not found');
    }

    // Verify buyer has purchased this product (in a DELIVERED order)
    const purchased = await this.prisma.orderItem.findFirst({
      where: {
        productId,
        order: {
          buyerId: userId,
          orderStatus: 'DELIVERED',
        },
      },
    });

    if (!purchased) {
      throw new BadRequestException(
        'You can only review products you have purchased and received',
      );
    }

    // Check for existing review (Prisma unique constraint will also catch this)
    const existing = await this.prisma.review.findUnique({
      where: { userId_productId: { userId, productId } },
    });

    if (existing) {
      throw new ConflictException('You have already reviewed this product');
    }

    const review = await this.prisma.review.create({
      data: { userId, productId, rating, comment },
      select: {
        id: true,
        userId: true,
        productId: true,
        rating: true,
        comment: true,
        createdAt: true,
      },
    });

    // Update seller's average rating
    await this.updateSellerRating(product.sellerId);

    this.logger.log(
      `Review created by user ${userId} for product ${productId}: ${rating}/5`,
    );

    return review;
  }

  /**
   * Get all reviews for a product.
   */
  async getProductReviews(productId: string) {
    const product = await this.prisma.product.findUnique({
      where: { id: productId },
    });

    if (!product) {
      throw new NotFoundException('Product not found');
    }

    const reviews = await this.prisma.review.findMany({
      where: { productId },
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        rating: true,
        comment: true,
        createdAt: true,
        user: {
          select: {
            id: true,
            buyerProfile: {
              select: { legalName: true, city: true },
            },
          },
        },
      },
    });

    // Compute average rating
    const avgResult = await this.prisma.review.aggregate({
      where: { productId },
      _avg: { rating: true },
      _count: { id: true },
    });

    return {
      productId,
      averageRating: +(avgResult._avg.rating ?? 0).toFixed(1),
      totalReviews: avgResult._count.id,
      reviews,
    };
  }

  /**
   * Recalculate and update the seller's average rating.
   */
  private async updateSellerRating(sellerId: string) {
    const result = await this.prisma.review.aggregate({
      where: { product: { sellerId } },
      _avg: { rating: true },
    });

    const avgRating = +(result._avg.rating ?? 0).toFixed(1);

    await this.prisma.sellerProfile.update({
      where: { id: sellerId },
      data: { rating: avgRating },
    });
  }
}
