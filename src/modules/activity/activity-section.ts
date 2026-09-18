import { TAB_KEYS, TabKey } from '../../common/admin-access/admin-access.types';

/**
 * Which sidebar tab a request belongs to.
 *
 * Kept as its own small map rather than reusing `resolveAdminRoute` from
 * admin-access: that function answers a different question ("what grant does
 * this route demand"), and its answers include `allow`, `super`, `anyWrite`
 * and `deny` — none of which is a tab name. A route can legitimately require
 * no tab and still belong on a tab for reporting. Borrowing it would couple
 * the log's labels to permission decisions and break both the first time
 * either changed.
 *
 * The labels below are the same strings as TAB_KEYS, so the log's sections
 * line up exactly with the panel's sidebar and with the `activity` grant.
 */

interface SectionRule {
  pattern: RegExp;
  section: TabKey | 'other';
}

/** First match wins, so put the specific patterns above the general ones. */
const RULES: SectionRule[] = [
  { pattern: /^\/admin\/admins(\/|$)/, section: 'admins' },
  { pattern: /^\/admin\/settings(\/|$)/, section: 'settings' },
  { pattern: /^\/admin\/analytics(\/|$)/, section: 'dashboard' },
  { pattern: /^\/admin\/dashboard(\/|$)/, section: 'dashboard' },

  { pattern: /^\/admin\/users(\/|$)/, section: 'users' },
  { pattern: /^\/admin\/buyers(\/|$)/, section: 'users' },
  { pattern: /^\/admin\/sellers(\/|$)/, section: 'users' },
  { pattern: /^\/buyers(\/|$)/, section: 'users' },
  { pattern: /^\/sellers(\/|$)/, section: 'users' },

  { pattern: /^\/admin\/orders(\/|$)/, section: 'orders' },
  { pattern: /^\/orders(\/|$)/, section: 'orders' },
  { pattern: /^\/admin\/self-ship(\/|$)/, section: 'selfShip' },

  { pattern: /^\/admin\/payments(\/|$)/, section: 'settlements' },
  { pattern: /^\/payments(\/|$)/, section: 'settlements' },
  { pattern: /^\/settlements(\/|$)/, section: 'settlements' },

  { pattern: /^\/products(\/|$)/, section: 'products' },
  { pattern: /^\/admin\/products(\/|$)/, section: 'products' },
  { pattern: /^\/admin\/product-requests(\/|$)/, section: 'products' },
  { pattern: /^\/admin\/suggestions(\/|$)/, section: 'suggestions' },
  { pattern: /^\/categories(\/|$)/, section: 'categories' },
  { pattern: /^\/brands(\/|$)/, section: 'brands' },

  { pattern: /^\/reviews(\/|$)/, section: 'reviews' },
  { pattern: /^\/tickets(\/|$)/, section: 'tickets' },

  { pattern: /^\/banners(\/|$)/, section: 'banners' },
  { pattern: /^\/admin\/homepage-sections(\/|$)/, section: 'homepageSections' },
  { pattern: /^\/admin\/marketing(\/|$)/, section: 'marketing' },
  { pattern: /^\/admin\/collections(\/|$)/, section: 'marketing' },
  { pattern: /^\/admin\/referrals(\/|$)/, section: 'marketing' },
  { pattern: /^\/blog(\/|$)/, section: 'blogs' },
  { pattern: /^\/admin\/blog(\/|$)/, section: 'blogs' },
  { pattern: /^\/seo(\/|$)/, section: 'seo' },
  { pattern: /^\/chatbot(\/|$)/, section: 'chatbot' },
  { pattern: /^\/admin\/notifications(\/|$)/, section: 'notifications' },

  { pattern: /^\/storage(\/|$)/, section: 'other' },
  { pattern: /^\/migration(\/|$)/, section: 'other' },
];

/**
 * Resolves a path to a section label.
 *
 * Falls back to `other` rather than throwing or guessing: an unmapped route
 * still gets logged, still shows its full path in the table, and simply files
 * under "Other" until someone adds a rule. Losing the entry would be worse
 * than filing it imprecisely.
 */
export function resolveSection(path: string): string {
  for (const rule of RULES) {
    if (rule.pattern.test(path)) return rule.section;
  }
  return 'other';
}

/** Every section value the log can produce, for the filter dropdown. */
export const ALL_SECTIONS: string[] = [...TAB_KEYS, 'other'];
