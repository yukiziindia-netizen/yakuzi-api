import { PrismaClient } from '@prisma/client';

// One-time backfill for the api#53 gap: CatalogProductImage.order was added
// with no backfill, so every image row saved before that fix still ties at
// order 0. Ties meant different queries (admin edit form vs. buyer grid vs.
// PDP) could each land on a different "first" image with no guarantee they
// agreed - e.g. Maayan Issue 4 showing its real cover in admin but a random
// interior panel on the buyer homepage. The code fix adds `id` as a
// deterministic secondary sort so all views now agree; this script persists
// real order values (0..n-1, same id-ascending order the tiebreaker already
// produces) so nothing depends on the tiebreaker going forward.
const prisma = new PrismaClient();

async function run() {
  const images = await prisma.catalogProductImage.findMany({
    orderBy: [{ masterProductId: 'asc' }, { order: 'asc' }, { id: 'asc' }],
  });

  const byProduct = new Map<string, typeof images>();
  for (const img of images) {
    const list = byProduct.get(img.masterProductId) ?? [];
    list.push(img);
    byProduct.set(img.masterProductId, list);
  }

  let productsFixed = 0;
  let rowsFixed = 0;

  for (const [masterProductId, group] of byProduct) {
    const orders = group.map((g) => g.order);
    const hasTie = new Set(orders).size !== orders.length;
    const alreadySequential = orders.every((o, i) => o === i);
    if (!hasTie && alreadySequential) continue;

    await prisma.$transaction(
      group.map((img, index) =>
        prisma.catalogProductImage.update({
          where: { id: img.id },
          data: { order: index },
        }),
      ),
    );
    productsFixed++;
    rowsFixed += group.length;
    console.log(`Fixed ${group.length} image(s) for product ${masterProductId}`);
  }

  console.log(`Backfill complete. ${productsFixed} product(s), ${rowsFixed} image row(s) updated.`);
}

run()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
