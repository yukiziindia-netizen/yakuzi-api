import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../../database/prisma.service';

/**
 * Internal search-index service.
 * Maintains denormalised ProductSearchIndex for fast full-text search.
 * NOT exposed as public API — called internally by ProductsService.
 */
@Injectable()
export class SearchIndexService {
  private readonly logger = new Logger(SearchIndexService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Create or update the search index entry for a product.
   * Called after product create/update.
   */
  async upsert(
    productId: string,
    data: {
      name: string;
      manufacturer: string;
      chemicalComposition: string;
      categoryName: string;
      subCategoryName: string;
    },
  ) {
    try {
      const searchVector = this.buildSearchVector(data);

      await this.prisma.productSearchIndex.upsert({
        where: { productId },
        create: {
          productId,
          name: data.name,
          manufacturer: data.manufacturer,
          chemicalComposition: data.chemicalComposition,
          categoryName: data.categoryName,
          subCategoryName: data.subCategoryName,
          searchVector,
        },
        update: {
          name: data.name,
          manufacturer: data.manufacturer,
          chemicalComposition: data.chemicalComposition,
          categoryName: data.categoryName,
          subCategoryName: data.subCategoryName,
          searchVector,
        },
      });

      this.logger.debug(`Search index upserted for product ${productId}`);
    } catch (error) {
      this.logger.error(
        `Failed to upsert search index for product ${productId}: ${error}`,
      );
    }
  }

  /**
   * Remove the search index entry when a product is deleted.
   */
  async remove(productId: string) {
    try {
      await this.prisma.productSearchIndex.delete({
        where: { productId },
      });
      this.logger.debug(`Search index removed for product ${productId}`);
    } catch (error) {
      this.logger.error(
        `Failed to remove search index for product ${productId}: ${error}`,
      );
    }
  }

  /**
   * Build a concatenated lowercase search string for fast ILIKE queries.
   * Phase-2+ will replace this with PostgreSQL tsvector/GIN indexes.
   */
  private buildSearchVector(data: {
    name: string;
    manufacturer: string;
    chemicalComposition: string;
    categoryName: string;
    subCategoryName: string;
  }): string {
    return [
      data.name,
      data.manufacturer,
      data.chemicalComposition,
      data.categoryName,
      data.subCategoryName,
    ]
      .join(' ')
      .toLowerCase()
      .trim();
  }
}
