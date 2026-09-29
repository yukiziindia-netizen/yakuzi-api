/**
 * Addresses on domains that cannot receive mail, and where to send instead.
 *
 * yukizi.in has no MX record. It is registered and now 301-redirects to
 * yukizi.com, but no mail server has ever accepted mail for it — every
 * message to an @yukizi.in address bounces. yukizi.com has live Google
 * Workspace.
 *
 * This exists because the platform's own addresses are admin-editable, and a
 * value typed into a settings box is never checked for deliverability. An
 * address that bounces is the worst kind of wrong: nothing errors, nothing is
 * logged at the point of failure, and the first sign of trouble is a customer
 * asking why nobody replied.
 *
 * Scope is deliberately narrow, and worth being explicit about:
 *
 *   - This is ONLY for addresses Yukizi owns — the support inbox and the
 *     platform alert recipient.
 *   - It must NEVER be applied to a buyer's or seller's address. Rewriting
 *     somebody else's email would send their order confirmation to a stranger.
 *     Their address belongs to them, broken or not.
 *
 * TO REMOVE: correct the values in Admin -> Settings, then delete the entry
 * below. If mail is ever set up on yukizi.in, removing it restores full
 * control to the settings.
 */
const RETIRED_MAIL_DOMAINS: Record<string, string> = {
  'yukizi.in': 'yukizi.com',
};

/**
 * Rewrites one of our own addresses off a domain that cannot receive mail.
 *
 * Matches the domain exactly, not as a suffix: mail.yukizi.in and
 * notyukizi.in are left alone, because neither is known to be ours or known
 * to be broken. Anything unrecognised is returned untouched, so an address
 * deliberately configured elsewhere keeps working exactly as set.
 */
export function usableOwnAddress(
  email: string | undefined,
): string | undefined {
  const trimmed = email?.trim();
  if (!trimmed) return trimmed;

  const at = trimmed.lastIndexOf('@');
  if (at < 0) return trimmed;

  const replacement = RETIRED_MAIL_DOMAINS[trimmed.slice(at + 1).toLowerCase()];
  if (!replacement) return trimmed;

  return `${trimmed.slice(0, at)}@${replacement}`;
}

/** True when the address is on a domain known to bounce. For logging. */
export function isRetiredDomain(email: string | undefined): boolean {
  const trimmed = email?.trim();
  if (!trimmed) return false;
  const at = trimmed.lastIndexOf('@');
  if (at < 0) return false;
  return trimmed.slice(at + 1).toLowerCase() in RETIRED_MAIL_DOMAINS;
}
