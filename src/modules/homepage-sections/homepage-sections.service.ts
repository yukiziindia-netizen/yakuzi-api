import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { IsString, IsOptional, IsBoolean, IsInt, Min, Max } from 'class-validator';
import { PrismaService } from '../../database/prisma.service';
import { ProductsService } from '../products/products.service';

export class CreateHomepageSectionDto {
  @IsOptional()
  @IsString()
  categoryId?: string;

  @IsOptional()
  @IsString()
  subCategoryId?: string;

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
  subCategoryId?: string;

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

const SECTION_INCLUDE = { category: true, subCategory: { include: { category: true } } } as const;

@Injectable()
export class HomepageSectionsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly productsService: ProductsService,
  ) {}

  async create(data: { categoryId?: string; subCategoryId?: string; title?: string; productLimit?: number; order?: number }) {
    const hasCategory = !!data.categoryId;
    const hasSubCategory = !!data.subCategoryId;
    if (hasCategory === hasSubCategory) {
      throw new BadRequestException('Provide exactly one of categoryId or subCategoryId');
    }

    return this.prisma.homepageSection.create({
      data: {
        categoryId: data.categoryId ?? null,
        subCategoryId: data.subCategoryId ?? null,
        title: data.title,
        productLimit: data.productLimit ?? 16,
        order: data.order ?? 0,
      },
      include: SECTION_INCLUDE,
    });
  }

  async findAllAdmin() {
    return this.prisma.homepageSection.findMany({
      orderBy: { order: 'asc' },
      include: SECTION_INCLUDE,
    });
  }

  async update(
    id: string,
    data: { categoryId?: string; subCategoryId?: string; title?: string; productLimit?: number; order?: number; isActive?: boolean },
  ) {
    if (data.categoryId !== undefined && data.subCategoryId !== undefined) {
      throw new BadRequestException('Provide exactly one of categoryId or subCategoryId, not both');
    }

    const existing = await this.prisma.homepageSection.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException('Homepage section not found');

    const updateData: any = {};
    if (data.categoryId !== undefined) {
      updateData.categoryId = data.categoryId;
      updateData.subCategoryId = null;
    }
    if (data.subCategoryId !== undefined) {
      updateData.subCategoryId = data.subCategoryId;
      updateData.categoryId = null;
    }
    if (data.title !== undefined) updateData.title = data.title;
    if (data.productLimit !== undefined) updateData.productLimit = data.productLimit;
    if (data.order !== undefined) updateData.order = data.order;
    if (data.isActive !== undefined) updateData.isActive = data.isActive;

    return this.prisma.homepageSection.update({
      where: { id },
      data: updateData,
      include: SECTION_INCLUDE,
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
      include: SECTION_INCLUDE,
    });

    const withProducts = await Promise.all(
      sections.map(async (section) => {
        const { products } = await this.productsService.findAll({
          categoryId: section.categoryId ?? undefined,
          limit: section.productLimit,
          sortBy: 'newest',
          sortOrder: 'desc',
        });
        return {
          id: section.id,
          title: section.title || section.category?.name || '',
          order: section.order,
          category: section.category
            ? { id: section.category.id, name: section.category.name, slug: section.category.slug }
            : null,
          // Sub-collection-sourced rows fall out of findAllPublic entirely for now
          // (see the categoryId-only query above), so this is always null here.
          // Real subCategory branching is a separate later task.
          subCategory: null,
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
