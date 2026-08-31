import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';
import { StorageService } from '../storage/storage.service';

/**
 * One-time (but safely re-runnable) SEO rename of EXISTING product images.
 *
 * COPY, never move: the object is duplicated in the bucket under
 * "<product-name-slug>-yukizi-<n>.<ext>" in the same folder, and only then
 * does the DB row point at the new URL. The old object stays alive forever —
 * Google's image index, cached pages and carts holding old URL snapshots
 * never 404. Idempotent via the "-yukizi-" filename marker; batched so the
 * admin can click through the catalog without HTTP timeouts.
 */
@Injectable()
export class ImageRenameService {
  private readonly logger = new Logger(ImageRenameService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
  ) {}

  private slugify(name: string): string {
    return name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/(^-|-$)+/g, '')
      .slice(0, 60);
  }

  /** Bucket key for our own public URLs; null for foreign/unparseable URLs. */
  private keyFromUrl(url: string): string | null {
    const m = url.match(/^https:\/\/storage\.googleapis\.com\/[^/]+\/(.+)$/);
    return m ? decodeURIComponent(m[1]) : null;
  }

  async renameProductImages(limit = 20) {
    const products = await this.prisma.catalogProduct.findMany({
      where: {
        deletedAt: null,
        images: { some: { url: { not: { contains: '-yukizi-' } } } },
      },
      select: {
        id: true,
        name: true,
        images: {
          orderBy: [{ order: 'asc' }, { id: 'asc' }],
          select: { id: true, url: true },
        },
      },
      take: limit,
    });

    let renamed = 0;
    let skipped = 0;
    let failed = 0;

    for (const product of products) {
      const slug = this.slugify(product.name || '');
      if (!slug) {
        skipped += product.images.length;
        continue;
      }
      const urlMap = new Map<string, string>();

      for (let i = 0; i < product.images.length; i++) {
        const img = product.images[i];
        const key = this.keyFromUrl(img.url);
        // Foreign URLs (placeholders, external CDNs) and already-renamed
        // files are left alone.
        if (!key || key.includes('-yukizi-')) {
          skipped++;
          continue;
        }
        const dir = key.includes('/') ? key.slice(0, key.lastIndexOf('/')) : '';
        const oldFile = key.slice(key.lastIndexOf('/') + 1);
        const dot = oldFile.lastIndexOf('.');
        const ext = dot > -1 ? oldFile.slice(dot).toLowerCase() : '';
        const newKey = `${dir ? `${dir}/` : ''}${slug}-yukizi-${i + 1}${ext}`;

        try {
          const newUrl = await this.storage.copyObject(key, newKey);
          if (!newUrl) {
            failed++;
            continue;
          }
          // DB only after the copy succeeded — a failed copy changes nothing.
          await this.prisma.catalogProductImage.update({
            where: { id: img.id },
            data: { url: newUrl },
          });
          urlMap.set(img.url, newUrl);
          renamed++;
        } catch (error) {
          failed++;
          this.logger.warn(
            `image rename failed for ${key}: ${error instanceof Error ? error.message : String(error)}`,
          );
        }
      }

      // Follow the rename in the product's per-image ALT overrides (keyed by
      // URL in its SeoMeta record) so manual alts survive the new URLs.
      if (urlMap.size > 0) {
        await this.migrateAltOverrideKeys(product.id, urlMap);
      }
    }

    const remaining = await this.prisma.catalogProduct.count({
      where: {
        deletedAt: null,
        images: { some: { url: { not: { contains: '-yukizi-' } } } },
      },
    });

    return { processedProducts: products.length, renamed, skipped, failed, remaining };
  }

  private async migrateAltOverrideKeys(
    catalogProductId: string,
    urlMap: Map<string, string>,
  ): Promise<void> {
    try {
      const record = await (this.prisma as any).seoMeta.findFirst({
        where: { entityType: 'PRODUCT', entityId: catalogProductId },
        select: { id: true, imageAltOverrides: true },
      });
      const overrides = record?.imageAltOverrides as Record<string, string> | null;
      if (!record || !overrides || typeof overrides !== 'object') return;
      let changed = false;
      const next: Record<string, string> = {};
      for (const [url, alt] of Object.entries(overrides)) {
        const newUrl = urlMap.get(url);
        next[newUrl ?? url] = alt;
        if (newUrl) changed = true;
      }
      if (changed) {
        await (this.prisma as any).seoMeta.update({
          where: { id: record.id },
          data: { imageAltOverrides: next },
        });
      }
    } catch (error) {
      this.logger.warn(
        `alt-override key migration failed for product ${catalogProductId}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
}
