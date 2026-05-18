import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';
import { CreateCustomOrderDto } from './dto/create-custom-order.dto';

@Injectable()
export class CustomOrdersService {
  constructor(private readonly prisma: PrismaService) {}

  async create(userId: string, dto: CreateCustomOrderDto) {
    const buyerProfile = await this.prisma.buyerProfile.findUnique({
      where: { userId },
    });

    if (!buyerProfile) {
      throw new NotFoundException('Buyer profile not found. Please complete onboarding.');
    }

    let finalProductId = dto.productId;

    // Resolve seller-specific Product ID to its MasterProduct ID if needed
    if (finalProductId) {
      // 1. Check if it's already a MasterProduct ID
      const masterProduct = await this.prisma.masterProduct.findUnique({
        where: { id: finalProductId },
        select: { id: true },
      });

      if (!masterProduct) {
        // 2. Try to resolve from seller-specific Product
        const sellerProduct = await this.prisma.product.findUnique({
          where: { id: finalProductId },
          select: { masterProductId: true },
        });

        if (sellerProduct?.masterProductId) {
          finalProductId = sellerProduct.masterProductId;
        } else {
          // 3. Fallback: If ID cannot be resolved to a MasterProduct, 
          // set to undefined to prevent foreign key violation. The message remains.
          finalProductId = undefined;
        }
      }
    }

    return await this.prisma.customOrder.create({
      data: {
        buyerId: buyerProfile.id,
        productId: finalProductId,
        message: dto.message,
      },
      include: {
        product: true,
      },
    });
  }

  async findAll(page = 1, limit = 20) {
    const skip = (page - 1) * limit;
    const [data, total] = await Promise.all([
      this.prisma.customOrder.findMany({
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
        include: {
          buyer: {
            include: {
              user: {
                select: { phone: true, email: true }
              }
            }
          },
          product: true,
        },
      }),
      this.prisma.customOrder.count(),
    ]);

    return { data, total, page, limit, totalPages: Math.ceil(total / limit) };
  }

  async updateStatus(id: string, status: string) {
    return await this.prisma.customOrder.update({
      where: { id },
      data: { status },
    });
  }

  async delete(id: string) {
    return await this.prisma.customOrder.delete({
      where: { id },
    });
  }
}
