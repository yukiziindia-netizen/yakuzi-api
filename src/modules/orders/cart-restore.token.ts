import { createHmac, timingSafeEqual } from 'crypto';

/**
 * Signs the "put these items back in my cart" link that goes into the
 * payment-recovery email.
 *
 * The link has to work from an email client, where the reader is very often
 * not carrying a session — so it cannot be a normal authenticated call. A
 * signed token is what stands in for that session.
 *
 * What a leaked token can do is bounded on purpose: it refills one specific
 * buyer's own cart with the items from one specific abandoned order of theirs.
 * It cannot read anything, place an order, spend anything, or touch another
 * account. That is a deliberately boring capability, because a URL that lives
 * in an inbox forever should not be able to do anything interesting.
 */

const VERSION = 'v1';

function secret(): string {
  // JWT_SECRET is required at boot (see app.module.ts's Joi schema), so this
  // is never the empty string in a running process.
  return process.env.JWT_SECRET ?? '';
}

function digest(orderId: string, buyerId: string): string {
  return createHmac('sha256', secret())
    .update(`${VERSION}:cart-restore:${orderId}:${buyerId}`)
    .digest('base64url');
}

export function signCartRestore(orderId: string, buyerId: string): string {
  return digest(orderId, buyerId);
}

/**
 * Constant-time check. Returns false rather than throwing on anything
 * malformed, so a truncated or mangled link from an email client is simply a
 * link that does not work.
 */
export function verifyCartRestore(
  orderId: string,
  buyerId: string,
  token: string,
): boolean {
  if (!token) return false;
  try {
    const expected = Buffer.from(digest(orderId, buyerId));
    const given = Buffer.from(String(token));
    if (expected.length !== given.length) return false;
    return timingSafeEqual(expected, given);
  } catch {
    return false;
  }
}
