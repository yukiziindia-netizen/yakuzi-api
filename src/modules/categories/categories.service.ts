import {
  Injectable,
  NotFoundException,
  ConflictException,
  Logger,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../database/prisma.service';
import { CreateCategoryDto } from './dto/create-category.dto';
import { UpdateCategoryDto } from './dto/update-category.dto';
import { CreateSubCategoryDto } from './dto/create-subcategory.dto';
import { UpdateSubCategoryDto } from './dto/update-subcategory.dto';
import { BulkCreateCategoryDto } from './dto/bulk-category.dto';
import { BulkCreateSubCategoryDto } from './dto/bulk-category.dto';
import { QuerySubCategoryDto } from './dto/query-subcategory.dto';

@Injectable()
export class CategoriesService {
  private readonly logger = new Logger(CategoriesService.name);

  constructor(private readonly prisma: PrismaService) {}

  // ──────────────────────────────────────────────
  // CATEGORIES
  // ──────────────────────────────────────────────

  private generateSlug(name: string): string {
    return name
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9\s-]/g, '')
      .replace(/\s+/g, '-')
      .replace(/-+/g, '-');
  }

  async createCategory(dto: CreateCategoryDto) {
    const name = dto.name.trim();
    const slug = this.generateSlug(name);

    try {
      const category = await this.prisma.category.create({
        data: { name, slug },
      });
      this.logger.log(`Category created: ${category.id} - ${name}`);
      return category;
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        throw new ConflictException(`Category "${name}" already exists`);
      }
      throw error;
    }
  }

  async findAllCategories() {
    return this.prisma.category.findMany({
      include: { subCategories: true },
      orderBy: { name: 'asc' },
    });
  }

  async updateCategory(id: string, dto: UpdateCategoryDto) {
    const existing = await this.prisma.category.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException('Category not found');

    const data: Prisma.CategoryUpdateInput = {};
    if (dto.name) {
      data.name = dto.name.trim();
      data.slug = this.generateSlug(dto.name);
    }

    try {
      const updated = await this.prisma.category.update({
        where: { id },
        data,
      });
      this.logger.log(`Category updated: ${id}`);
      return updated;
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        throw new ConflictException(`Category "${dto.name}" already exists`);
      }
      throw error;
    }
  }

  async deleteCategory(id: string) {
    const existing = await this.prisma.category.findUnique({
      where: { id },
      include: { _count: { select: { products: true, subCategories: true } } },
    });
    if (!existing) throw new NotFoundException('Category not found');

    await this.prisma.category.delete({ where: { id } });
    this.logger.log(`Category deleted: ${id}`);
    return { message: 'Category deleted successfully' };
  }

  async getCategoryMap() {
    const categories = await this.prisma.category.findMany({
      select: { id: true, name: true },
      orderBy: { name: 'asc' },
    });
    const map: Record<string, string> = {};
    for (const cat of categories) {
      map[cat.name] = cat.id;
    }
    return map;
  }

  async bulkCreateCategories(dto: BulkCreateCategoryDto) {
    const results = { success: 0, failed: 0, errors: [] as { name: string; reason: string }[] };

    for (const item of dto.categories) {
      try {
        await this.createCategory(item);
        results.success++;
      } catch (error) {
        results.failed++;
        results.errors.push({
          name: item.name,
          reason: error instanceof Error ? error.message : 'Unknown error',
        });
      }
    }

    this.logger.log(`Bulk category creation: ${results.success} success, ${results.failed} failed`);
    return results;
  }

  // ──────────────────────────────────────────────
  // SUBCATEGORIES
  // ──────────────────────────────────────────────

  async createSubCategory(dto: CreateSubCategoryDto) {
    const name = dto.name.trim();
    const slug = this.generateSlug(name);

    const category = await this.prisma.category.findUnique({
      where: { id: dto.categoryId },
    });
    if (!category) throw new NotFoundException('Category not found');

    try {
      const subCategory = await this.prisma.subCategory.create({
        data: {
          name,
          slug,
          categoryId: dto.categoryId,
        },
        include: { category: true },
      });
      this.logger.log(`SubCategory created: ${subCategory.id} - ${name}`);
      return subCategory;
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        throw new ConflictException(
          `SubCategory "${name}" already exists under this category`,
        );
      }
      throw error;
    }
  }

  async findAllSubCategories(query: QuerySubCategoryDto) {
    const where: Prisma.SubCategoryWhereInput = {};
    if (query.categoryId) where.categoryId = query.categoryId;

    return this.prisma.subCategory.findMany({
      where,
      include: { category: true },
      orderBy: { name: 'asc' },
    });
  }

  async updateSubCategory(id: string, dto: UpdateSubCategoryDto) {
    const existing = await this.prisma.subCategory.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException('SubCategory not found');

    const data: Prisma.SubCategoryUpdateInput = {};
    if (dto.name) {
      data.name = dto.name.trim();
      data.slug = this.generateSlug(dto.name);
    }

    try {
      const updated = await this.prisma.subCategory.update({
        where: { id },
        data,
        include: { category: true },
      });
      this.logger.log(`SubCategory updated: ${id}`);
      return updated;
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        throw new ConflictException(
          `SubCategory "${dto.name}" already exists under this category`,
        );
      }
      throw error;
    }
  }

  async deleteSubCategory(id: string) {
    const existing = await this.prisma.subCategory.findUnique({
      where: { id },
      include: { _count: { select: { products: true } } },
    });
    if (!existing) throw new NotFoundException('SubCategory not found');

    await this.prisma.subCategory.delete({ where: { id } });
    this.logger.log(`SubCategory deleted: ${id}`);
    return { message: 'SubCategory deleted successfully' };
  }

  async getSubCategoryMap() {
    const subCategories = await this.prisma.subCategory.findMany({
      select: { id: true, name: true, categoryId: true, category: { select: { name: true } } },
      orderBy: { name: 'asc' },
    });
    const map: Record<string, string> = {};
    for (const sub of subCategories) {
      // Key format: "CategoryName::SubCategoryName" for disambiguation
      map[`${sub.category.name}::${sub.name}`] = sub.id;
    }
    return map;
  }

  async bulkCreateSubCategories(dto: BulkCreateSubCategoryDto) {
    const results = { success: 0, failed: 0, errors: [] as { name: string; categoryId: string; reason: string }[] };

    for (const item of dto.subcategories) {
      try {
        await this.createSubCategory(item);
        results.success++;
      } catch (error) {
        results.failed++;
        results.errors.push({
          name: item.name,
          categoryId: item.categoryId,
          reason: error instanceof Error ? error.message : 'Unknown error',
        });
      }
    }

    this.logger.log(`Bulk subcategory creation: ${results.success} success, ${results.failed} failed`);
    return results;
  }
}
