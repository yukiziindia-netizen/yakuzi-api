import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { IsString, IsOptional, IsBoolean, IsInt, Min, Max, IsArray, ArrayNotEmpty, ArrayUnique } from 'class-validator';
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

export class ReorderHomepageSectionsDto {
  @IsArray()
  @ArrayNotEmpty()
  @ArrayUnique()
  @IsString({ each: true })
  orderedIds!: string[];
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

  async reorder(orderedIds: string[]) {
    const existing = await this.prisma.homepageSection.findMany({ select: { id: true } });
    const existingIds = existing.map((s) => s.id).sort();
    const givenIds = [...orderedIds].sort();

    const isValid = givenIds.length === existingIds.length && givenIds.every((id, i) => id === existingIds[i]);
    if (!isValid) {
      throw new BadRequestException('orderedIds must contain exactly the current set of homepage section ids, each exactly once');
    }

    await this.prisma.$transaction(
      orderedIds.map((id, index) => this.prisma.homepageSection.update({ where: { id }, data: { order: index } })),
    );

    return this.findAllAdmin();
  }

  async findAllPublic() {
    const sections = await this.prisma.homepageSection.findMany({
      where: { isActive: true },
      orderBy: { order: 'asc' },
      include: SECTION_INCLUDE,
    });

    const withProducts = await Promise.all(
      sections.map(async (section) => {
        const productFilter = section.categoryId
          ? { categoryId: section.categoryId }
          : { subCategoryId: section.subCategoryId! };
        const { products } = await this.productsService.findAll({
          ...productFilter,
          limit: section.productLimit,
          sortBy: 'newest',
          sortOrder: 'desc',
        });
        return {
          id: section.id,
          title: section.title || section.category?.name || section.subCategory?.name || '',
          order: section.order,
          category: section.category
            ? { id: section.category.id, name: section.category.name, slug: section.category.slug }
            : null,
          subCategory: section.subCategory
            ? {
                id: section.subCategory.id,
                name: section.subCategory.name,
                slug: section.subCategory.slug,
                categorySlug: section.subCategory.category.slug,
              }
            : null,
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
