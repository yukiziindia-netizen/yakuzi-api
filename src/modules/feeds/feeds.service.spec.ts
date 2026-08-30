import { FeedsService } from './feeds.service';

describe('FeedsService.googleMerchantFeed', () => {
  const product = (over: Record<string, unknown> = {}) => ({
    id: 'prod-1',
    name: 'Goku 1/7 Scale Figure',
    slug: 'goku-scale-figure',
    price: 12499.5,
    mrp: 13999,
    stock: 3,
    hasSellers: true,
    image: 'https://cdn.example.com/goku.png',
    manufacturer: 'Bandai',
    category: { name: 'Figurines' },
    subCategory: { name: 'Scale Figures' },
    ...over,
  });

  const build = (products: unknown[], descriptions: { id: string; description: string | null }[] = []) => {
    const prisma = {
      catalogProduct: { findMany: jest.fn().mockResolvedValue(descriptions) },
    };
    const productsService = {
      findAll: jest.fn().mockResolvedValue({ products, total: products.length }),
    };
    const service = new FeedsService(prisma as never, productsService as never);
    return { service, prisma, productsService };
  };

  it('emits a valid item with price, availability, link and identifier_exists=false', async () => {
    const { service } = build(
      [product()],
      [{ id: 'prod-1', description: 'A detailed 1/7 scale figure.' }],
    );

    const xml = await service.googleMerchantFeed();

    expect(xml).toContain('<g:id>prod-1</g:id>');
    expect(xml).toContain('<g:price>12499.50 INR</g:price>');
    expect(xml).toContain('<g:availability>in_stock</g:availability>');
    expect(xml).toContain('/products/goku-scale-figure</g:link>');
    expect(xml).toContain('<g:identifier_exists>false</g:identifier_exists>');
    expect(xml).toContain('<g:brand>Bandai</g:brand>');
    expect(xml).toContain('<g:description>A detailed 1/7 scale figure.</g:description>');
    expect(xml).toContain('<g:product_type>Figurines &gt; Scale Figures</g:product_type>');
  });

  it('marks zero-stock products out_of_stock instead of dropping them', async () => {
    const { service } = build([product({ stock: 0 })]);

    const xml = await service.googleMerchantFeed();

    expect(xml).toContain('<g:availability>out_of_stock</g:availability>');
  });

  it('skips products without an image (GMC would only disapprove them)', async () => {
    const { service } = build([product({ image: null })]);

    const xml = await service.googleMerchantFeed();

    expect(xml).not.toContain('<item>');
  });

  it('never emits the seeded "Unknown" placeholder as a brand', async () => {
    const { service } = build([product({ manufacturer: 'Unknown' })]);

    const xml = await service.googleMerchantFeed();

    expect(xml).not.toContain('<g:brand>');
  });

  it('escapes XML special characters in titles', async () => {
    const { service } = build([product({ name: 'Cat & Dog <Limited> "Ed."' })]);

    const xml = await service.googleMerchantFeed();

    expect(xml).toContain('Cat &amp; Dog &lt;Limited&gt; &quot;Ed.&quot;');
  });

  it('serves from cache within the TTL (one pricing query for repeat fetches)', async () => {
    const { service, productsService } = build([product()]);

    await service.googleMerchantFeed();
    await service.googleMerchantFeed();

    expect(productsService.findAll).toHaveBeenCalledTimes(1);
  });
});
