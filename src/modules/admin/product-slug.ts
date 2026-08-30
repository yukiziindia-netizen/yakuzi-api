import { BadRequestException, ConflictException } from '@nestjs/common';

/**
 * Product slug changes with SEO safety.
 *
 * Changing a slug changes the product's public URL, so every change MUST:
 *  1. delete any redirect that would shadow the NEW live URL
 *     (renaming A→B and later B→A would otherwise leave a rule hijacking B)
 *  2. repoint existing redirects that targeted the OLD URL straight at the
 *     new one (kills two-hop chains X→old→new)
 *  3. create a 301 from the old URL to the new one so existing Google
 *     results, shares and ads keep working
 * All four writes ride one transaction with the slug update itself. The
 * buyer middleware already consumes these rules via /seo/redirects/map.
 */

const SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
/** Slugs that would collide with buyer routes or read as ids. */
const RESERVED = new Set(['add', 'new', 'edit', 'all', 'search', 'category', 'products']);
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Lowercase, collapse whitespace/punctuation to single hyphens, trim hyphens. */
export function normalizeSlug(raw: string): string {
  return raw
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)+/g, '');
}

/** Throws BadRequestException with a human reason when the slug can't be used. */
export function assertValidSlug(slug: string): void {
  if (!slug) throw new BadRequestException('Slug cannot be empty');
  if (slug.length > 200) throw new BadRequestException('Slug is too long (max 200 characters)');
  if (!SLUG_PATTERN.test(slug)) {
    throw new BadRequestException('Slug may only contain lowercase letters, numbers and single hyphens');
  }
  if (RESERVED.has(slug)) throw new BadRequestException(`"${slug}" is a reserved path and cannot be used`);
  if (UUID_PATTERN.test(slug)) {
    // The PDP resolves UUID-shaped paths as product ids — a UUID slug would
    // point at a different product or nothing.
    throw new BadRequestException('Slug cannot look like a product id');
  }
}

/** The subset of PrismaClient this module touches (kept narrow for tests). */
export interface SlugPrisma {
  catalogProduct: {
    findFirst(args: unknown): Promise<{ id: string } | null>;
    update(args: unknown): Promise<unknown>;
  };
  seoRedirect: {
    deleteMany(args: unknown): Promise<unknown>;
    updateMany(args: unknown): Promise<unknown>;
    upsert(args: unknown): Promise<unknown>;
  };
  $transaction<T>(fn: (tx: SlugPrisma) => Promise<T>): Promise<T>;
}

export interface SlugChangeOptions {
  /**
   * Create the old-URL -> new-URL 301 (step 3). Default true. Opting out is
   * an explicit editor choice ("I never shared the old URL"); the shadow
   * cleanup and chain repointing (steps 1-2) always run regardless — those
   * are correctness, not preference.
   */
  createRedirect?: boolean;
}

/**
 * seoRedirect bookkeeping for ANY public path change (products, blog posts):
 * kill rules shadowing the new URL, collapse chains pointing at the old one,
 * and (unless opted out) 301 the old URL to the new. Runs on the caller's
 * transaction client.
 */
export async function swapPathRedirects(
  tx: Pick<SlugPrisma, 'seoRedirect'>,
  oldPath: string | null,
  newPath: string,
  note: string,
  options: SlugChangeOptions = {},
): Promise<void> {
  const createRedirect = options.createRedirect !== false;
  // 1. Nothing may redirect AWAY from the URL that is about to go live.
  await tx.seoRedirect.deleteMany({ where: { fromPath: newPath } });
  if (!oldPath || oldPath === newPath) return;
  // 2. Rules that pointed at the old URL now point at the new one.
  await tx.seoRedirect.updateMany({ where: { toPath: oldPath }, data: { toPath: newPath } });
  if (!createRedirect) return;
  // 3. The old URL 301s to the new one (upsert: re-renaming reuses the row).
  await tx.seoRedirect.upsert({
    where: { fromPath: oldPath },
    create: { fromPath: oldPath, toPath: newPath, statusCode: 301, isActive: true, note },
    update: { toPath: newPath, statusCode: 301, isActive: true },
  });
}

/**
 * Applies a slug change for a product. No-op when the normalized slug equals
 * the current one. Returns the slug that is now live.
 */
export async function applySlugChange(
  prisma: SlugPrisma,
  product: { id: string; slug: string | null },
  requestedSlug: string,
  options: SlugChangeOptions = {},
): Promise<string> {
  const next = normalizeSlug(requestedSlug);
  assertValidSlug(next);
  if (next === product.slug) return next;

  const taken = await prisma.catalogProduct.findFirst({
    where: { slug: next, id: { not: product.id } },
    select: { id: true },
  });
  if (taken) throw new ConflictException(`Another product already uses the slug "${next}"`);

  const newPath = `/products/${next}`;
  const oldPath = product.slug ? `/products/${product.slug}` : null;

  await prisma.$transaction(async (tx) => {
    await swapPathRedirects(
      tx,
      oldPath,
      newPath,
      `auto: product slug change (${product.id})`,
      options,
    );
    // The slug itself.
    await tx.catalogProduct.update({ where: { id: product.id }, data: { slug: next } });
  });

  return next;
}
