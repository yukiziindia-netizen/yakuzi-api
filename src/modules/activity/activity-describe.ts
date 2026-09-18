/**
 * Turning a request into something a human wants to read, safely.
 *
 * Two jobs, kept together because they are the same problem seen twice: decide
 * what an action WAS, and decide what is safe to keep about it.
 */

/**
 * Keys whose values must never reach the log.
 *
 * Matched case-insensitively as substrings, so `newPassword`, `password_2` and
 * `PASSWORD` are all caught by `password`. The list is deliberately broad: the
 * cost of over-redacting is an unhelpful log line, the cost of under-redacting
 * is an audit table that has quietly become a second copy of the credentials
 * and identity documents it was meant to describe.
 */
const REDACT_KEYS = [
  'password',
  'newpassword',
  'oldpassword',
  'token',
  'accesstoken',
  'refreshtoken',
  'secret',
  'otp',
  'pin',
  'apikey',
  'authorization',
  'cvv',
  'bankaccount',
  'accountnumber',
  'ifsc',
  'cancelcheck',
  'aadhaar',
  'pannumber',
  'gstnumber',
  'druglicense',
  'drugLicence',
  'document',
];

const REDACTED = '[redacted]';

/** Longest string kept in the log. Anything longer is truncated with a note. */
const MAX_STRING = 300;
/** Deepest object nesting kept. Below this, a placeholder is stored instead. */
const MAX_DEPTH = 4;
/** Most array items kept, so a bulk import cannot write a megabyte row. */
const MAX_ARRAY = 20;

function shouldRedact(key: string): boolean {
  const k = key.toLowerCase();
  return REDACT_KEYS.some((r) => k.includes(r.toLowerCase()));
}

/**
 * Deep-copies a request body, dropping anything sensitive and bounding size.
 *
 * Returns `null` for an empty body so the column stays null rather than `{}`.
 */
export function redact(value: unknown, depth = 0): unknown {
  if (value === null || value === undefined) return null;

  if (typeof value === 'string') {
    return value.length > MAX_STRING
      ? `${value.slice(0, MAX_STRING)}… [${value.length} chars]`
      : value;
  }

  if (typeof value === 'number' || typeof value === 'boolean') return value;

  if (depth >= MAX_DEPTH) return '[nested]';

  if (Array.isArray(value)) {
    const kept = value.slice(0, MAX_ARRAY).map((v) => redact(v, depth + 1));
    if (value.length > MAX_ARRAY) {
      kept.push(`… ${value.length - MAX_ARRAY} more`);
    }
    return kept;
  }

  if (typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = shouldRedact(k) ? REDACTED : redact(v, depth + 1);
    }
    return out;
  }

  // Functions, symbols, bigints — nothing a request body should contain.
  return null;
}

export function redactBody(body: unknown): unknown | null {
  const cleaned = redact(body);
  if (
    cleaned === null ||
    (typeof cleaned === 'object' && Object.keys(cleaned as object).length === 0)
  ) {
    return null;
  }
  return cleaned;
}

export interface DescribedAction {
  description: string;
  targetType?: string;
  targetId?: string;
}

/** A UUID as it appears in a path segment. */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Verb-shaped last segments. `/admin/users/:id/approve` should read
 * "Approved user", not "Updated approve".
 */
const ACTION_VERBS: Record<string, string> = {
  approve: 'Approved',
  reject: 'Rejected',
  block: 'Blocked',
  unblock: 'Unblocked',
  confirm: 'Confirmed',
  cancel: 'Cancelled',
  ship: 'Marked as shipped',
  deliver: 'Marked as delivered',
  refund: 'Refunded',
  verify: 'Verified',
  publish: 'Published',
  unpublish: 'Unpublished',
  activate: 'Activated',
  deactivate: 'Deactivated',
  reorder: 'Reordered',
  restore: 'Restored',
  resend: 'Resent',
  broadcast: 'Sent a broadcast for',
  settle: 'Settled',
  assign: 'Assigned',
  close: 'Closed',
  reopen: 'Reopened',
};

/**
 * Singular, human labels for the collection segment of a path. Anything not
 * listed falls back to the raw segment, which is still readable
 * ("homepage-sections" -> "homepage section").
 */
const RESOURCE_LABELS: Record<string, string> = {
  users: 'user',
  buyers: 'buyer',
  sellers: 'seller',
  admins: 'admin',
  orders: 'order',
  products: 'product',
  categories: 'category',
  brands: 'brand',
  banners: 'banner',
  blogs: 'blog post',
  reviews: 'review',
  tickets: 'ticket',
  payments: 'payment',
  settlements: 'settlement',
  notifications: 'notification',
  collections: 'collection',
  referrals: 'referral',
  suggestions: 'suggestion',
  settings: 'setting',
  seo: 'SEO record',
  'homepage-sections': 'homepage section',
  'custom-orders': 'custom order',
  'product-requests': 'product request',
  'self-ship': 'self-ship record',
};

function labelFor(segment: string): string {
  return RESOURCE_LABELS[segment] ?? segment.replace(/-/g, ' ');
}

const METHOD_VERBS: Record<string, string> = {
  POST: 'Created',
  PATCH: 'Updated',
  PUT: 'Updated',
  DELETE: 'Deleted',
};

/**
 * Builds the one-line description shown in the table.
 *
 * Derived from the URL rather than hand-written per route, which is the whole
 * point of capturing centrally: a route added next year is described the day
 * it ships, without anyone remembering to do anything. The phrasing is good
 * enough to scan — "Approved seller", "Deleted product", "Updated setting" —
 * and the exact path is stored alongside for when it is not.
 */
export function describeAction(
  method: string,
  path: string,
  body: unknown,
): DescribedAction {
  // /admin/users/<id>/approve -> ['users', '<id>', 'approve']
  const segments = path
    .replace(/^\/+/, '')
    .split('/')
    .filter(Boolean)
    .filter((s) => s !== 'admin' && s !== 'api');

  if (segments.length === 0) {
    return { description: `${METHOD_VERBS[method] ?? method} something` };
  }

  const last = segments[segments.length - 1];
  const ids = segments.filter((s) => UUID.test(s));
  const targetId = ids.length ? ids[ids.length - 1] : undefined;

  // The resource is the first non-id segment — "users" in /users/<id>/approve.
  const resourceSegment = segments.find((s) => !UUID.test(s)) ?? segments[0];
  const targetType = resourceSegment;
  const resource = labelFor(resourceSegment);

  // Verb-shaped tail: "Approved seller".
  const verb = ACTION_VERBS[last.toLowerCase()];
  if (verb && last !== resourceSegment) {
    return { description: `${verb} ${resource}`, targetType, targetId };
  }

  // A trailing sub-resource that is neither an id nor a known verb reads
  // better included: /orders/<id>/status -> "Updated order status".
  const tail =
    !UUID.test(last) && last !== resourceSegment
      ? ` ${last.replace(/-/g, ' ')}`
      : '';

  const base = `${METHOD_VERBS[method] ?? method} ${resource}${tail}`;

  // A name in the body is far more useful than an id in a table.
  const label = extractLabel(body);
  return {
    description: label ? `${base} “${label}”` : base,
    targetType,
    targetId,
  };
}

/** Fields worth quoting in the description, in order of preference. */
const LABEL_FIELDS = ['name', 'title', 'displayName', 'legalName', 'companyName', 'label'];

/** Pulls a short human name out of a request body, if one is obviously there. */
export function extractLabel(body: unknown): string | undefined {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return undefined;
  const record = body as Record<string, unknown>;
  for (const field of LABEL_FIELDS) {
    const value = record[field];
    if (typeof value === 'string' && value.trim() && value.length <= 120) {
      return value.trim();
    }
  }
  return undefined;
}
