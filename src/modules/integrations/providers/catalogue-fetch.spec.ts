import axios from 'axios';
import { ConfigService } from '@nestjs/config';
import { ShopifyProvider } from './shopify.provider';
import { WooCommerceProvider } from './woocommerce.provider';
import { AmazonProvider } from './amazon.provider';

jest.mock('axios');
const mockedAxios = axios as jest.Mocked<typeof axios>;

// The SSRF guard resolves hostnames for real; stub it for the Woo tests.
jest.mock('../store-url.util', () => ({
  ...jest.requireActual('../store-url.util'),
  assertPublicHostname: jest.fn().mockResolvedValue(undefined),
}));

const config = (values: Record<string, string> = {}) =>
  ({ get: jest.fn((key: string) => values[key]) }) as unknown as ConfigService;

describe('ShopifyProvider.fetchProductsPage', () => {
  const provider = new ShopifyProvider(
    config({
      SHOPIFY_CLIENT_ID: 'id',
      SHOPIFY_CLIENT_SECRET: 'secret',
      SHOPIFY_REDIRECT_URI: 'https://yukizi.com/cb',
    }),
  );

  beforeEach(() => jest.clearAllMocks());

  it('flattens variants into rows, since the variant carries the SKU and the stock', async () => {
    mockedAxios.get.mockResolvedValue({
      data: {
        products: [
          {
            id: 111,
            title: 'Naruto Figure',
            variants: [
              { id: 1, sku: 'YK-1', title: 'Default Title', inventory_quantity: 4, inventory_item_id: 90 },
              { id: 2, sku: 'YK-2', title: 'Large', inventory_quantity: 7, inventory_item_id: 91 },
            ],
          },
        ],
      },
      headers: {},
    } as never);

    const page = await provider.fetchProductsPage('demo.myshopify.com', 'token');

    expect(page.products).toHaveLength(2);
    // "Default Title" is Shopify's placeholder for a product with no real
    // variants — showing it to a seller would be noise.
    expect(page.products[0]).toMatchObject({
      externalProductId: '111',
      externalVariantId: '1',
      sku: 'YK-1',
      title: 'Naruto Figure',
      quantity: 4,
      fulfillmentChannel: 'MERCHANT',
    });
    expect(page.products[1].title).toBe('Naruto Figure — Large');
    expect(page.nextCursor).toBeNull();
  });

  it('reads the next cursor out of the Link header', async () => {
    mockedAxios.get.mockResolvedValue({
      data: { products: [] },
      headers: {
        link: '<https://demo.myshopify.com/admin/api/2025-01/products.json?page_info=NEXT123&limit=250>; rel="next"',
      },
    } as never);

    const page = await provider.fetchProductsPage('demo.myshopify.com', 'token');

    expect(page.nextCursor).toBe('NEXT123');
  });

  it('ignores a Link header that only points backwards', async () => {
    mockedAxios.get.mockResolvedValue({
      data: { products: [] },
      headers: {
        link: '<https://demo.myshopify.com/admin/api/2025-01/products.json?page_info=PREV>; rel="previous"',
      },
    } as never);

    expect(
      (await provider.fetchProductsPage('demo.myshopify.com', 'token')).nextCursor,
    ).toBeNull();
  });

  it('sends the cursor as page_info and nothing else Shopify would reject', async () => {
    mockedAxios.get.mockResolvedValue({ data: { products: [] }, headers: {} } as never);

    await provider.fetchProductsPage('demo.myshopify.com', 'token', 'CURSOR');

    const url = mockedAxios.get.mock.calls[0][0] as string;
    expect(url).toContain('page_info=CURSOR');
    expect(url).toContain('limit=250');
  });
});

describe('WooCommerceProvider.fetchProductsPage', () => {
  const provider = new WooCommerceProvider();
  const credentials = { consumerKey: 'ck', consumerSecret: 'cs' };

  beforeEach(() => jest.clearAllMocks());

  it('reads a simple product directly', async () => {
    mockedAxios.get.mockResolvedValue({
      data: [{ id: 5, name: 'Poster', sku: 'YK-P', type: 'simple', stock_quantity: 3 }],
      headers: { 'x-wp-totalpages': '1' },
    } as never);

    const page = await provider.fetchProductsPage(
      'https://mystore.com',
      credentials,
    );

    expect(page.products).toEqual([
      {
        externalProductId: '5',
        externalVariantId: null,
        sku: 'YK-P',
        title: 'Poster',
        quantity: 3,
        fulfillmentChannel: 'MERCHANT',
      },
    ]);
    expect(page.nextCursor).toBeNull();
  });

  it('expands a variable product into its variations, which carry the SKUs', async () => {
    mockedAxios.get
      .mockResolvedValueOnce({
        data: [{ id: 9, name: 'Hoodie', type: 'variable', stock_quantity: null }],
        headers: { 'x-wp-totalpages': '1' },
      } as never)
      .mockResolvedValueOnce({
        data: [
          { id: 91, name: 'Medium', sku: 'YK-H-M', stock_quantity: 2 },
          { id: 92, name: 'Large', sku: 'YK-H-L', stock_quantity: 5 },
        ],
      } as never);

    const page = await provider.fetchProductsPage(
      'https://mystore.com',
      credentials,
    );

    expect(page.products).toHaveLength(2);
    expect(page.products[0]).toMatchObject({
      externalProductId: '9',
      externalVariantId: '91',
      sku: 'YK-H-M',
      title: 'Hoodie — Medium',
      quantity: 2,
    });
  });

  it('keeps importing when one product’s variations cannot be read', async () => {
    mockedAxios.get
      .mockResolvedValueOnce({
        data: [{ id: 9, name: 'Hoodie', type: 'variable' }],
        headers: { 'x-wp-totalpages': '1' },
      } as never)
      .mockRejectedValueOnce(new Error('403'));

    const page = await provider.fetchProductsPage(
      'https://mystore.com',
      credentials,
    );

    expect(page.products).toEqual([]);
  });

  it('advances to the next page while the store reports more', async () => {
    mockedAxios.get.mockResolvedValue({
      data: [],
      headers: { 'x-wp-totalpages': '3' },
    } as never);

    expect(
      (await provider.fetchProductsPage('https://mystore.com', credentials, 1))
        .nextCursor,
    ).toBe('2');
    expect(
      (await provider.fetchProductsPage('https://mystore.com', credentials, 3))
        .nextCursor,
    ).toBeNull();
  });
});

describe('AmazonProvider.fetchListingsPage', () => {
  const provider = new AmazonProvider(
    config({
      AMAZON_LWA_CLIENT_ID: 'id',
      AMAZON_LWA_CLIENT_SECRET: 'secret',
      AMAZON_SP_API_APP_ID: 'app',
      AMAZON_REDIRECT_URI: 'https://yukizi.com/cb',
    }),
  );
  const credentials = {
    refreshToken: 'Atzr|refresh',
    sellingPartnerId: 'A1SELLER',
    marketplaceId: 'A21TJRUUN4KGV',
    region: 'eu',
  };

  beforeEach(() => {
    jest.clearAllMocks();
    // getAccessToken posts to LWA first.
    mockedAxios.post.mockResolvedValue({
      data: { access_token: 'Atza|access', expires_in: 3600 },
    } as never);
  });

  it('marks merchant-fulfilled stock as MERCHANT and Amazon-held stock as AMAZON_FBA', async () => {
    mockedAxios.get.mockResolvedValue({
      data: {
        items: [
          {
            sku: 'YK-A',
            summaries: [{ asin: 'B00TEST', itemName: 'Figure' }],
            fulfillmentAvailability: [
              { fulfillmentChannelCode: 'DEFAULT', quantity: 6 },
              { fulfillmentChannelCode: 'AMAZON_EU', quantity: 40 },
            ],
          },
        ],
        pagination: { nextToken: 'TOKEN2' },
      },
    } as never);

    const page = await provider.fetchListingsPage(credentials);

    expect(page.products).toHaveLength(2);
    expect(page.products[0]).toMatchObject({
      sku: 'YK-A',
      asin: 'B00TEST',
      quantity: 6,
      fulfillmentChannel: 'MERCHANT',
      externalVariantId: null,
    });
    // FBA is a separate row so it can be displayed but never treated as
    // seller-controlled stock.
    expect(page.products[1]).toMatchObject({
      quantity: 40,
      fulfillmentChannel: 'AMAZON_FBA',
      externalVariantId: 'AMAZON_EU',
    });
    expect(page.nextCursor).toBe('TOKEN2');
  });

  it('reports unknown quantity as null rather than zero when Amazon sends no availability', async () => {
    mockedAxios.get.mockResolvedValue({
      data: {
        items: [{ sku: 'YK-B', summaries: [{ asin: 'B01', itemName: 'Poster' }] }],
      },
    } as never);

    const page = await provider.fetchListingsPage(credentials);

    // null means "not known", which must not be confused with "out of stock".
    expect(page.products[0].quantity).toBeNull();
    expect(page.nextCursor).toBeNull();
  });

  it('passes the marketplace and page token, and asks only for the data it uses', async () => {
    mockedAxios.get.mockResolvedValue({ data: { items: [] } } as never);

    await provider.fetchListingsPage(credentials, 'TOKEN9');

    const options = mockedAxios.get.mock.calls[0][1] as { params: Record<string, string> };
    expect(options.params).toMatchObject({
      marketplaceIds: 'A21TJRUUN4KGV',
      includedData: 'summaries,fulfillmentAvailability',
      pageToken: 'TOKEN9',
    });
  });
});
