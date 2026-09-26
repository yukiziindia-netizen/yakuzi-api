import { createHash } from 'crypto';

/**
 * Builds the Conversions API event payload Meta expects, and hashes the
 * customer identifiers the way Meta requires. Pure and isolated: this is the
 * part with real correctness risk (a wrong hash or field silently drops match
 * quality to zero), and the only part testable without a live Pixel.
 *
 * Meta matches a server event to a person by SHA-256 of normalised
 * identifiers — lower-cased, trimmed email; digits-only phone with country
 * code. `event_id` is what deduplicates this server event against the browser
 * Pixel's event for the same action, so the two are counted once, not twice.
 */

/** SHA-256 hex of a normalised value, or undefined when there is nothing to hash. */
export function hashIdentifier(value: string | null | undefined, kind: 'email' | 'phone' | 'text'): string | undefined {
  if (!value) return undefined;
  let normalised = value.trim().toLowerCase();
  if (kind === 'phone') {
    // Digits only. A leading 0 is a domestic prefix, not part of the number;
    // a bare 10-digit Indian number gets its 91 country code so it matches the
    // browser Pixel, which Meta normalises the same way.
    normalised = value.replace(/[^0-9]/g, '').replace(/^0+/, '');
    if (normalised.length === 10) normalised = `91${normalised}`;
  }
  if (!normalised) return undefined;
  return createHash('sha256').update(normalised).digest('hex');
}

export interface PurchaseEventInput {
  eventId: string;
  eventTimeSeconds: number;
  email?: string | null;
  phone?: string | null;
  userId?: string | null;
  value: number;
  currency: string;
  sourceUrl?: string;
  /** The Pixel's browser cookies, when the event originated from a live page. */
  fbp?: string | null;
  fbc?: string | null;
  clientIp?: string | null;
  clientUserAgent?: string | null;
}

export function buildPurchaseEvent(input: PurchaseEventInput): Record<string, unknown> {
  const userData: Record<string, unknown> = {};
  const em = hashIdentifier(input.email, 'email');
  const ph = hashIdentifier(input.phone, 'phone');
  const externalId = hashIdentifier(input.userId, 'text');
  if (em) userData.em = [em];
  if (ph) userData.ph = [ph];
  if (externalId) userData.external_id = [externalId];
  // Not hashed — Meta takes these raw for match quality.
  if (input.fbp) userData.fbp = input.fbp;
  if (input.fbc) userData.fbc = input.fbc;
  if (input.clientIp) userData.client_ip_address = input.clientIp;
  if (input.clientUserAgent) userData.client_user_agent = input.clientUserAgent;

  const event: Record<string, unknown> = {
    event_name: 'Purchase',
    event_time: input.eventTimeSeconds,
    // Dedups against the browser Pixel's Purchase for the same order.
    event_id: input.eventId,
    action_source: 'website',
    user_data: userData,
    custom_data: {
      currency: input.currency,
      value: Number(input.value.toFixed(2)),
    },
  };
  if (input.sourceUrl) event.event_source_url = input.sourceUrl;
  return event;
}

export function buildRequestBody(
  events: Record<string, unknown>[],
  testEventCode?: string | null,
): Record<string, unknown> {
  const body: Record<string, unknown> = { data: events };
  if (testEventCode) body.test_event_code = testEventCode;
  return body;
}
