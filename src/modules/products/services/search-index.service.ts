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
    catalogProductId: string,
    data: {
      name: string;
      manufacturer: string;

      categoryName: string;
      subCategoryName: string;
    },
  ) {
    try {
      const searchVector = this.buildSearchVector(data);

      await this.prisma.productSearchIndex.upsert({
        where: { catalogProductId },
        create: {
          catalogProductId,
          name: data.name,
          manufacturer: data.manufacturer,

          categoryName: data.categoryName,
          subCategoryName: data.subCategoryName,
          searchVector,
        },
        update: {
          name: data.name,
          manufacturer: data.manufacturer,

          categoryName: data.categoryName,
          subCategoryName: data.subCategoryName,
          searchVector,
        },
      });

      this.logger.debug(
        `Search index upserted for product ${catalogProductId}`,
      );
    } catch (error) {
      this.logger.error(
        `Failed to upsert search index for product ${catalogProductId}: ${error}`,
      );
    }
  }

  /**
   * Remove the search index entry when a product is deleted.
   */
  async remove(catalogProductId: string) {
    try {
      await this.prisma.productSearchIndex.delete({
        where: { catalogProductId },
      });
      this.logger.debug(`Search index removed for product ${catalogProductId}`);
    } catch (error) {
      this.logger.error(
        `Failed to remove search index for product ${catalogProductId}: ${error}`,
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

    categoryName: string;
    subCategoryName: string;
  }): string {
    return [
      data.name,
      data.manufacturer,

      data.categoryName,
      data.subCategoryName,
    ]
      .join(' ')
      .toLowerCase()
      .trim();
  }
}
