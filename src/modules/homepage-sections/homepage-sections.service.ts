import { Injectable, NotFoundException } from '@nestjs/common';
import { IsString, IsOptional, IsBoolean, IsInt, IsNotEmpty, Min, Max } from 'class-validator';
import { PrismaService } from '../../database/prisma.service';
import { ProductsService } from '../products/products.service';

export class CreateHomepageSectionDto {
  @IsString()
  @IsNotEmpty()
  categoryId!: string;

  @IsOptional()
  @IsString()
  title?: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(50)
  productLimit?: number;

  @IsOptional()
  @IsInt()
  order?: number;
}

export class UpdateHomepageSectionDto {
  @IsOptional()
  @IsString()
  categoryId?: string;

  @IsOptional()
  @IsString()
  title?: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(50)
  productLimit?: number;

  @IsOptional()
  @IsInt()
  order?: number;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

@Injectable()
export class HomepageSectionsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly productsService: ProductsService,
  ) {}

  async create(data: { categoryId: string; title?: string; productLimit?: number; order?: number }) {
    return this.prisma.homepageSection.create({
      data: {
        categoryId: data.categoryId,
        title: data.title,
        productLimit: data.productLimit ?? 16,
        order: data.order ?? 0,
      },
      include: { category: true },
    });
  }

  async findAllAdmin() {
    return this.prisma.homepageSection.findMany({
      orderBy: { order: 'asc' },
      include: { category: true },
    });
  }

  async update(
    id: string,
    data: { categoryId?: string; title?: string; productLimit?: number; order?: number; isActive?: boolean },
  ) {
    const existing = await this.prisma.homepageSection.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException('Homepage section not found');

    const updateData: any = {};
    if (data.categoryId !== undefined) updateData.categoryId = data.categoryId;
    if (data.title !== undefined) updateData.title = data.title;
    if (data.productLimit !== undefined) updateData.productLimit = data.productLimit;
    if (data.order !== undefined) updateData.order = data.order;
    if (data.isActive !== undefined) updateData.isActive = data.isActive;

    return this.prisma.homepageSection.update({
      where: { id },
      data: updateData,
      include: { category: true },
    });
  }

  async remove(id: string) {
    const existing = await this.prisma.homepageSection.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException('Homepage section not found');
    return this.prisma.homepageSection.delete({ where: { id } });
  }

  async findAllPublic() {
    const sections = await this.prisma.homepageSection.findMany({
      where: { isActive: true },
      orderBy: { order: 'asc' },
      include: { category: true },
    });

    const withProducts = await Promise.all(
      sections.map(async (section) => {
        const { products } = await this.productsService.findAll({
          categoryId: section.categoryId,
          limit: section.productLimit,
          sortBy: 'newest',
          sortOrder: 'desc',
        });
        return {
          id: section.id,
          title: section.title || section.category.name,
          order: section.order,
          category: {
            id: section.category.id,
            name: section.category.name,
            slug: section.category.slug,
          },
          products,
        };
      }),
    );

    // A section for a category with nothing in it yet is not shown at all —
    // there's no useful "empty row" state, and the admin may be staging a
    // section ahead of adding products to that category.
    return withProducts.filter((section) => section.products.length > 0);
  }
}
