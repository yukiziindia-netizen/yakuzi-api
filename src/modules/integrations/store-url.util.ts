import { BadRequestException } from '@nestjs/common';
import { promises as dns } from 'dns';
import * as net from 'net';

/**
 * WooCommerce is the one integration where the seller hands us a URL that the
 * backend will then call. That makes it a server-side request forgery surface:
 * without these checks, "store URL" becomes a way to make Yukizi's servers GET
 * anything reachable from inside our network, including the cloud metadata
 * endpoint that hands out instance credentials.
 *
 * The rules below are deliberately strict. A real WooCommerce storefront is a
 * public HTTPS site on a real hostname; nothing legitimate is lost.
 */

/** Hostnames that are never a customer's storefront. */
const BLOCKED_HOSTNAMES = new Set([
  'localhost',
  'localhost.localdomain',
  'ip6-localhost',
  'ip6-loopback',
  // AWS/GCP/Azure/DO/Alibaba instance metadata aliases.
  'metadata',
  'metadata.google.internal',
  'metadata.goog',
  'instance-data',
]);

/** Suffixes that only resolve inside a private network. */
const BLOCKED_SUFFIXES = ['.local', '.internal', '.localdomain', '.home.arpa'];

/**
 * True when an IP literal belongs to a range that must never be fetched:
 * loopback, RFC1918 private, link-local (which covers 169.254.169.254, the
 * cloud metadata address), CGNAT, multicast, reserved, and the IPv6
 * equivalents including IPv4-mapped forms like ::ffff:127.0.0.1.
 */
export function isBlockedIpAddress(ip: string): boolean {
  const version = net.isIP(ip);
  if (version === 0) return false;

  if (version === 4) {
    const octets = ip.split('.').map(Number);
    if (octets.length !== 4 || octets.some((o) => Number.isNaN(o))) return true;
    const [a, b] = octets;

    if (a === 0) return true; // 0.0.0.0/8 "this network"
    if (a === 10) return true; // 10.0.0.0/8 private
    if (a === 127) return true; // loopback
    if (a === 169 && b === 254) return true; // link-local + metadata 169.254.169.254
    if (a === 172 && b >= 16 && b <= 31) return true; // 172.16.0.0/12 private
    if (a === 192 && b === 168) return true; // 192.168.0.0/16 private
    if (a === 192 && b === 0) return true; // 192.0.0.0/24 IETF protocol assignments
    if (a === 100 && b >= 64 && b <= 127) return true; // 100.64.0.0/10 CGNAT
    if (a >= 224) return true; // multicast + reserved + broadcast
    return false;
  }

  const lower = ip.toLowerCase();
  // IPv4-mapped / IPv4-compatible: re-check the embedded v4 address.
  const mapped = lower.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
  if (mapped) return isBlockedIpAddress(mapped[1]);

  if (lower === '::' || lower === '::1') return true; // unspecified, loopback
  if (lower.startsWith('fe80')) return true; // link-local
  if (/^f[cd]/.test(lower)) return true; // fc00::/7 unique local
  if (lower.startsWith('ff')) return true; // multicast
  return false;
}

/**
 * Normalises whatever the seller typed into a canonical https origin.
 * Accepts "mystore.com", "http://mystore.com", "https://mystore.com/shop/".
 *
 * Rejects anything that is not a plain public https origin: credentials in the
 * URL, non-default ports, IP literals, and blocked hostnames.
 */
export function normalizeStoreUrl(input: string): string {
  const trimmed = (input || '').trim();
  if (!trimmed) {
    throw new BadRequestException('Enter your WooCommerce store URL.');
  }
  if (trimmed.length > 255) {
    throw new BadRequestException('That store URL is too long.');
  }

  const withScheme = /^https?:\/\//i.test(trimmed)
    ? trimmed
    : `https://${trimmed}`;

  let url: URL;
  try {
    url = new URL(withScheme);
  } catch {
    throw new BadRequestException(
      "That doesn't look like a valid store URL. Example: https://mystore.com",
    );
  }

  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    throw new BadRequestException('Store URLs must start with https://');
  }
  if (url.username || url.password) {
    throw new BadRequestException(
      'Remove the username and password from the store URL.',
    );
  }
  // A non-standard port is a strong signal of an internal service rather than
  // a storefront.
  if (url.port && url.port !== '443' && url.port !== '80') {
    throw new BadRequestException(
      'Store URLs with a custom port are not supported.',
    );
  }

  const hostname = url.hostname.toLowerCase().replace(/\.$/, '');
  if (!hostname || !hostname.includes('.')) {
    throw new BadRequestException(
      "That doesn't look like a public store domain. Example: https://mystore.com",
    );
  }
  if (BLOCKED_HOSTNAMES.has(hostname)) {
    throw new BadRequestException('That store URL is not reachable publicly.');
  }
  if (BLOCKED_SUFFIXES.some((suffix) => hostname.endsWith(suffix))) {
    throw new BadRequestException('That store URL is not reachable publicly.');
  }
  // Bracketed IPv6 hostnames arrive as "[::1]" -> hostname "::1".
  if (net.isIP(hostname) !== 0) {
    throw new BadRequestException(
      'Enter your store domain rather than an IP address.',
    );
  }

  // WooCommerce is always served over TLS for the auth handshake; upgrade
  // http:// input rather than rejecting it, since sellers routinely omit it.
  const path = url.pathname.replace(/\/+$/, '');
  return `https://${hostname}${path}`;
}

/**
 * Resolves the hostname and rejects it if ANY address is private. Guards the
 * DNS-rebinding case that normalizeStoreUrl alone cannot: a public-looking
 * hostname whose A record points at 169.254.169.254.
 *
 * Call this immediately before making a request to a seller-supplied host.
 */
export async function assertPublicHostname(hostname: string): Promise<void> {
  let addresses: string[];
  try {
    const results = await dns.lookup(hostname, { all: true, verbatim: true });
    addresses = results.map((r) => r.address);
  } catch {
    throw new BadRequestException(
      "We couldn't find that store domain. Check the store URL and try again.",
    );
  }

  if (addresses.length === 0) {
    throw new BadRequestException(
      "We couldn't find that store domain. Check the store URL and try again.",
    );
  }
  if (addresses.some((address) => isBlockedIpAddress(address))) {
    throw new BadRequestException('That store URL is not reachable publicly.');
  }
}

/**
 * Shopify shop domains are a much narrower shape than a general URL: exactly
 * <store>.myshopify.com. Accepting anything else would let a seller point the
 * OAuth handshake at a host they control.
 */
export function normalizeShopifyDomain(input: string): string {
  const trimmed = (input || '').trim().toLowerCase();
  if (!trimmed) {
    throw new BadRequestException('Enter your Shopify store domain.');
  }

  // Tolerate a pasted admin URL: https://admin.shopify.com/store/foo or
  // https://foo.myshopify.com/admin
  let host = trimmed;
  if (/^https?:\/\//.test(host)) {
    try {
      const parsed = new URL(host);
      host =
        parsed.hostname === 'admin.shopify.com'
          ? `${parsed.pathname.split('/').filter(Boolean)[1] ?? ''}.myshopify.com`
          : parsed.hostname;
    } catch {
      throw new BadRequestException(
        'Enter your Shopify store domain, for example storename.myshopify.com',
      );
    }
  }
  host = host.replace(/\/.*$/, '').replace(/\.$/, '');

  // Bare store name -> full domain.
  if (!host.includes('.')) host = `${host}.myshopify.com`;

  if (!/^[a-z0-9][a-z0-9-]{0,59}\.myshopify\.com$/.test(host)) {
    throw new BadRequestException(
      'Enter your Shopify store domain, for example storename.myshopify.com',
    );
  }
  return host;
}
