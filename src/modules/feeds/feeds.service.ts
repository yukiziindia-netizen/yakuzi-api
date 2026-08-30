import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';
import { ProductsService } from '../products/products.service';

/**
 * Google Merchant Center product feed (RSS 2.0 + g: namespace).
 *
 * Marketplace model: Yukizi is the merchant of record. Each catalog product
 * appears ONCE, priced at the cheapest in-stock listing's final customer
 * price — the exact figure the PDP renders and its Product JSON-LD
 * advertises. Pricing is deliberately sourced from ProductsService.findAll
 * (the same computation the storefront uses) rather than re-implemented
 * here, so the feed and the page can never disagree — price mismatch is
 * GMC's #1 disapproval reason. Sellers coming and going is handled purely
 * by feed freshness: GMC re-fetches on a schedule and this endpoint always
 * reflects the current best listing.
 */
@Injectable()
export class FeedsService {
  private readonly logger = new Logger(FeedsService.name);

  // GMC fetches at most a few times a day; the catalog is small. A short
  // in-memory cache keeps a crawler burst from hammering the pricing query.
  private cache: { xml: string; expiresAt: number } | null = null;
  private static readonly CACHE_TTL_MS = 10 * 60_000;
  private static readonly PAGE_SIZE = 200;

  constructor(
    private readonly prisma: PrismaService,
    private readonly productsService: ProductsService,
  ) {}

  async googleMerchantFeed(): Promise<string> {
    if (this.cache && this.cache.expiresAt > Date.now()) {
      return this.cache.xml;
    }
    const xml = await this.buildFeed();
    this.cache = { xml, expiresAt: Date.now() + FeedsService.CACHE_TTL_MS };
    return xml;
  }

  private async buildFeed(): Promise<string> {
    const siteUrl = process.env.PUBLIC_SITE_URL?.trim() || 'https://yukizi.com';

    // Page through the storefront's own list endpoint logic.
    const products: any[] = [];
    for (let page = 1; page <= 50; page++) {
      const res = (await this.productsService.findAll({
        page,
        limit: FeedsService.PAGE_SIZE,
      } as never)) as { products?: unknown[]; data?: unknown[] };
      const batch = (res?.products ?? res?.data ?? []) as Record<
        string,
        any
      >[];
      products.push(...batch);
      if (batch.length < FeedsService.PAGE_SIZE) break;
    }

    // The list card omits description (payload weight for the grid) — fetch
    // descriptions in one extra query instead of changing the shared shape.
    const descById = new Map<string, string>();
    if (products.length > 0) {
      const rows = await this.prisma.catalogProduct.findMany({
        where: { id: { in: products.map((p) => String(p.id)) } },
        select: { id: true, description: true },
      });
      for (const r of rows) {
        if (r.description) descById.set(r.id, r.description);
      }
    }

    const items: string[] = [];
    for (const p of products) {
      // g:image_link is required — a product with no image would only be
      // disapproved by GMC, so it is skipped here and logged instead.
      if (!p?.image) {
        this.logger.warn(
          `google-merchant feed: skipping ${String(p?.id)} ("${String(p?.name)}") — no image`,
        );
        continue;
      }
      const price = Number(p.price ?? p.mrp);
      if (!Number.isFinite(price) || price <= 0) {
        this.logger.warn(
          `google-merchant feed: skipping ${String(p.id)} ("${String(p.name)}") — no usable price`,
        );
        continue;
      }

      const link = `${siteUrl}/products/${encodeURIComponent(String(p.slug || p.id))}`;
      const available =
        (Number(p.stock) || 0) > 0 && p.hasSellers !== false
          ? 'in_stock'
          : 'out_of_stock';
      const description = descById.get(String(p.id)) || String(p.name ?? '');
      const brand = this.realBrand(p.manufacturer);
      const productType = [p.category?.name, p.subCategory?.name]
        .filter(Boolean)
        .join(' > ');

      items.push(
        [
          '<item>',
          `<g:id>${this.esc(String(p.id))}</g:id>`,
          `<g:title>${this.esc(String(p.name ?? ''))}</g:title>`,
          `<g:description>${this.esc(this.truncate(description, 4900))}</g:description>`,
          `<g:link>${this.esc(link)}</g:link>`,
          `<g:image_link>${this.esc(String(p.image))}</g:image_link>`,
          `<g:availability>${available}</g:availability>`,
          `<g:price>${price.toFixed(2)} INR</g:price>`,
          '<g:condition>new</g:condition>',
          // No GTIN/MPN data exists in the catalog (typical for collectibles);
          // GMC accepts items without identifiers when this is declared.
          '<g:identifier_exists>false</g:identifier_exists>',
          ...(brand ? [`<g:brand>${this.esc(brand)}</g:brand>`] : []),
          ...(productType
            ? [`<g:product_type>${this.esc(productType)}</g:product_type>`]
            : []),
          '</item>',
        ].join(''),
      );
    }

    return [
      '<?xml version="1.0" encoding="UTF-8"?>',
      '<rss version="2.0" xmlns:g="http://base.google.com/ns/1.0">',
      '<channel>',
      '<title>Yukizi</title>',
      `<link>${this.esc(siteUrl)}</link>`,
      '<description>Anime, manga and pop-culture collectibles from verified sellers across India.</description>',
      ...items,
      '</channel>',
      '</rss>',
    ].join('\n');
  }

  /** "Unknown" is seeded placeholder data, not a brand — never emit it. */
  private realBrand(manufacturer: unknown): string | null {
    const m = typeof manufacturer === 'string' ? manufacturer.trim() : '';
    if (!m || m.toLowerCase() === 'unknown') return null;
    return m;
  }

  private truncate(value: string, max: number): string {
    return value.length > max ? `${value.slice(0, max - 1)}…` : value;
  }

  private esc(value: string): string {
    return String(value ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&apos;');
  }
}
