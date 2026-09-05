import { BadRequestException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as crypto from 'crypto';
import { EncryptionService } from './encryption.service';
import { ShopifyProvider } from './providers/shopify.provider';
import {
  isBlockedIpAddress,
  normalizeShopifyDomain,
  normalizeStoreUrl,
} from './store-url.util';

const KEY = 'a'.repeat(64); // 32 bytes of hex

const configWith = (values: Record<string, string>) =>
  ({
    get: jest.fn((key: string) => values[key]),
  }) as unknown as ConfigService;

describe('EncryptionService — credentials at rest', () => {
  it('round-trips a credential bundle', () => {
    const service = new EncryptionService(
      configWith({ INTEGRATIONS_ENCRYPTION_KEY: KEY }),
    );

    const sealed = service.encrypt({ accessToken: 'shpat_live_secret' });
    expect(sealed).not.toContain('shpat_live_secret');
    expect(service.decrypt(sealed)).toEqual({ accessToken: 'shpat_live_secret' });
  });

  it('produces different ciphertext each time, so identical tokens are not correlatable', () => {
    const service = new EncryptionService(
      configWith({ INTEGRATIONS_ENCRYPTION_KEY: KEY }),
    );

    const a = service.encrypt({ accessToken: 'same' });
    const b = service.encrypt({ accessToken: 'same' });
    expect(a).not.toEqual(b);
  });

  it('fails closed rather than storing plaintext when no key is configured', () => {
    const service = new EncryptionService(configWith({}));

    expect(service.isConfigured()).toBe(false);
    expect(() => service.encrypt({ accessToken: 'x' })).toThrow();
  });

  it('rejects a key that is not 32 bytes', () => {
    const service = new EncryptionService(
      configWith({ INTEGRATIONS_ENCRYPTION_KEY: 'too-short' }),
    );
    expect(service.isConfigured()).toBe(false);
  });

  it('returns null for tampered ciphertext instead of yielding altered credentials', () => {
    const service = new EncryptionService(
      configWith({ INTEGRATIONS_ENCRYPTION_KEY: KEY }),
    );
    const sealed = service.encrypt({ accessToken: 'shpat_live_secret' });

    const parts = sealed.split('.');
    // Flip a byte in the ciphertext; GCM's auth tag must catch it.
    const body = Buffer.from(parts[3], 'base64');
    body[0] = body[0] ^ 0xff;
    const tampered = [parts[0], parts[1], parts[2], body.toString('base64')].join('.');

    expect(service.decrypt(tampered)).toBeNull();
  });

  it('cannot decrypt with a different key', () => {
    const writer = new EncryptionService(
      configWith({ INTEGRATIONS_ENCRYPTION_KEY: KEY }),
    );
    const other = new EncryptionService(
      configWith({ INTEGRATIONS_ENCRYPTION_KEY: 'b'.repeat(64) }),
    );

    expect(other.decrypt(writer.encrypt({ accessToken: 'x' }))).toBeNull();
  });

  it('returns null rather than throwing for missing or malformed values', () => {
    const service = new EncryptionService(
      configWith({ INTEGRATIONS_ENCRYPTION_KEY: KEY }),
    );
    expect(service.decrypt(null)).toBeNull();
    expect(service.decrypt('not-an-envelope')).toBeNull();
  });
});

describe('store-url — SSRF protection', () => {
  it('blocks loopback, private, link-local and metadata addresses', () => {
    for (const ip of [
      '127.0.0.1',
      '10.0.0.5',
      '172.16.0.1',
      '172.31.255.255',
      '192.168.1.1',
      // The cloud metadata endpoint — the one that hands out instance creds.
      '169.254.169.254',
      '100.64.0.1',
      '0.0.0.0',
      '::1',
      'fe80::1',
      'fd00::1',
      // IPv4-mapped IPv6 must not be a bypass.
      '::ffff:127.0.0.1',
      '::ffff:169.254.169.254',
    ]) {
      expect(isBlockedIpAddress(ip)).toBe(true);
    }
  });

  it('allows ordinary public addresses', () => {
    for (const ip of ['8.8.8.8', '1.1.1.1', '172.32.0.1', '2606:4700::1111']) {
      expect(isBlockedIpAddress(ip)).toBe(false);
    }
  });

  it('rejects internal hostnames, IP literals and credential-bearing URLs', () => {
    for (const url of [
      'http://localhost/shop',
      'https://127.0.0.1',
      'https://169.254.169.254/latest/meta-data/',
      'https://metadata.google.internal',
      'https://intranet.local',
      'https://store.internal',
      'https://user:pass@mystore.com',
      // A non-standard port is a strong signal of an internal service.
      'https://mystore.com:8080',
      'not a url at all',
      '',
    ]) {
      expect(() => normalizeStoreUrl(url)).toThrow(BadRequestException);
    }
  });

  it('normalises what sellers actually type', () => {
    expect(normalizeStoreUrl('mystore.com')).toBe('https://mystore.com');
    expect(normalizeStoreUrl('http://mystore.com')).toBe('https://mystore.com');
    expect(normalizeStoreUrl('  https://MyStore.com/  ')).toBe(
      'https://mystore.com',
    );
    expect(normalizeStoreUrl('https://mystore.com/shop/')).toBe(
      'https://mystore.com/shop',
    );
  });
});

describe('store-url — Shopify domain normalisation', () => {
  it('accepts the forms sellers paste', () => {
    expect(normalizeShopifyDomain('demo')).toBe('demo.myshopify.com');
    expect(normalizeShopifyDomain('demo.myshopify.com')).toBe('demo.myshopify.com');
    expect(normalizeShopifyDomain('https://demo.myshopify.com/admin')).toBe(
      'demo.myshopify.com',
    );
    expect(normalizeShopifyDomain('https://admin.shopify.com/store/demo')).toBe(
      'demo.myshopify.com',
    );
    expect(normalizeShopifyDomain('  DEMO.myshopify.com ')).toBe(
      'demo.myshopify.com',
    );
  });

  it('refuses a host that is not a myshopify.com store, so the handshake cannot be pointed elsewhere', () => {
    for (const value of [
      'evil.com',
      'demo.myshopify.com.evil.com',
      'https://evil.com/demo.myshopify.com',
      '',
    ]) {
      expect(() => normalizeShopifyDomain(value)).toThrow(BadRequestException);
    }
  });
});

describe('ShopifyProvider — signature verification', () => {
  const secret = 'shopify-client-secret';
  const provider = new ShopifyProvider(
    configWith({
      SHOPIFY_CLIENT_ID: 'id',
      SHOPIFY_CLIENT_SECRET: secret,
      SHOPIFY_REDIRECT_URI: 'https://yukizi.com/api/integrations/shopify/callback',
    }),
  );

  const signQuery = (query: Record<string, string>) => {
    const message = Object.keys(query)
      .sort()
      .map((key) => `${key}=${query[key]}`)
      .join('&');
    return crypto.createHmac('sha256', secret).update(message).digest('hex');
  };

  it('accepts a correctly signed callback', () => {
    const query: Record<string, string> = {
      code: 'authcode',
      shop: 'demo.myshopify.com',
      state: 'abc',
      timestamp: '1700000000',
    };
    query.hmac = signQuery(query);

    expect(provider.verifyCallbackHmac(query)).toBe(true);
  });

  it('rejects a callback whose parameters were altered after signing', () => {
    const query: Record<string, string> = {
      code: 'authcode',
      shop: 'demo.myshopify.com',
      state: 'abc',
      timestamp: '1700000000',
    };
    query.hmac = signQuery(query);
    query.shop = 'attacker.myshopify.com';

    expect(provider.verifyCallbackHmac(query)).toBe(false);
  });

  it('rejects a callback with no signature at all', () => {
    expect(provider.verifyCallbackHmac({ code: 'x', shop: 'y' })).toBe(false);
  });

  it('validates webhook HMAC over the raw body, and rejects a re-serialised one', () => {
    // Byte-for-byte what Shopify would send, including insignificant spacing.
    const rawBody = Buffer.from('{"inventory_item_id":1,  "available":7}');
    const signature = crypto
      .createHmac('sha256', secret)
      .update(rawBody)
      .digest('base64');

    expect(provider.verifyWebhookHmac(rawBody, signature)).toBe(true);

    // JSON.parse -> JSON.stringify changes the bytes; the signature must fail.
    const reserialised = Buffer.from(JSON.stringify(JSON.parse(rawBody.toString())));
    expect(provider.verifyWebhookHmac(reserialised, signature)).toBe(false);
  });

  it('rejects an empty body or a missing header', () => {
    expect(provider.verifyWebhookHmac(undefined, 'sig')).toBe(false);
    expect(provider.verifyWebhookHmac(Buffer.from('{}'), undefined)).toBe(false);
  });

  it('reports itself unconfigured when app credentials are absent', () => {
    const bare = new ShopifyProvider(configWith({}));
    expect(bare.isConfigured()).toBe(false);
    expect(() => bare.buildAuthorizationUrl('demo.myshopify.com', 'state')).toThrow();
  });

  it('requests only the scopes this feature uses', () => {
    const url = provider.buildAuthorizationUrl('demo.myshopify.com', 'state-123');
    const scope = new URL(url).searchParams.get('scope') ?? '';

    expect(scope.split(',').sort()).toEqual([
      'read_inventory',
      'read_locations',
      'read_products',
      'write_inventory',
    ]);
    // No customer or order data is requested.
    expect(scope).not.toContain('customers');
    expect(scope).not.toContain('orders');
    expect(new URL(url).searchParams.get('state')).toBe('state-123');
  });
});
