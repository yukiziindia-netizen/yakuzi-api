import {
  THEME,
  link,
  sellerLink,
  adminLink,
  logoUrl,
  SUPPORT_EMAIL,
  storefrontUrl,
} from './email-theme';

/**
 * The shell every Yukizi email is poured into.
 *
 * Email rendering engines are twenty years behind browsers, so this is written
 * to their rules rather than the storefront's: tables for structure, inline
 * styles on every element, no flexbox, no grid, no external CSS. The look is
 * the storefront's — the technique is not.
 *
 * Two rules worth keeping when editing:
 *   1. Nothing essential may live only inside an image. Most clients block
 *      remote images until the reader allows them, so every layout here has to
 *      still read correctly with images off.
 *   2. Gradients degrade. Outlook ignores background-image, so any element
 *      using one also carries a solid bgcolor that is close enough to pass.
 */

/** Escapes text for HTML. Every caller-supplied string goes through this. */
export function escapeHtml(value: unknown): string {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * Escapes a URL for an href.
 *
 * Anything that is not plainly http(s) or mailto collapses to the storefront
 * home rather than being emitted: these URLs can originate in seller-typed
 * fields and courier APIs, and `javascript:` in a link an admin might click is
 * not a risk worth carrying for the sake of a tracking link.
 */
export function safeUrl(value: unknown): string {
  const raw = String(value ?? '').trim();
  if (/^(https?:|mailto:)/i.test(raw)) return escapeHtml(raw);
  return escapeHtml(storefrontUrl());
}

/**
 * Who is reading. Only changes the footer links and the sign-off line — a
 * seller sent to "Your orders" on the storefront would be looking at the wrong
 * orders, and an admin does not need a support address.
 */
export type Audience = 'buyer' | 'seller' | 'admin';

interface FooterConfig {
  help: string;
  links: { label: string; href: string }[];
  why: string;
}

function footerFor(audience: Audience): FooterConfig {
  if (audience === 'seller') {
    return {
      help: `Questions about this? Write to <a href="mailto:${SUPPORT_EMAIL}" style="color:${THEME.purple};font-weight:600;">${SUPPORT_EMAIL}</a> — a real person reads it.`,
      links: [
        { label: 'Seller dashboard', href: sellerLink('/dashboard') },
        { label: 'Your orders', href: sellerLink('/orders') },
        { label: 'Your products', href: sellerLink('/products') },
      ],
      why: 'You are receiving this because you sell on Yukizi.',
    };
  }
  if (audience === 'admin') {
    return {
      help: 'This is an automatic alert from the Yukizi platform.',
      links: [
        { label: 'Admin panel', href: adminLink('/dashboard') },
        { label: 'Orders', href: adminLink('/orders') },
        { label: 'Tickets', href: adminLink('/tickets') },
      ],
      why: 'You are receiving this because you are listed as a Yukizi alert recipient.',
    };
  }
  return {
    help: `Need a hand? Write to <a href="mailto:${SUPPORT_EMAIL}" style="color:${THEME.purple};font-weight:600;">${SUPPORT_EMAIL}</a> — a real person reads it.`,
    links: [
      { label: 'yukizi.com', href: link('/') },
      { label: 'Your orders', href: link('/orders') },
      { label: 'Support', href: link('/support') },
    ],
    why: 'You are receiving this because you have a Yukizi account.',
  };
}

export interface EmailOptions {
  /** The grey line under the subject in most inboxes. Always set it. */
  preheader: string;
  /** Small capitalised line above the headline, e.g. "Order update". */
  eyebrow?: string;
  /** The headline. One short sentence. */
  title: string;
  /** Optional line under the headline. */
  subtitle?: string;
  /** Rendered in order between the header and the footer. */
  blocks: string[];
  /** Small print above the sign-off, for context specific to this email. */
  footerNote?: string;
  /** Who is reading. Defaults to the buyer. */
  audience?: Audience;
}

/**
 * Renders a complete HTML document for one email.
 */
export function renderEmail(options: EmailOptions): string {
  const {
    preheader,
    eyebrow,
    title,
    subtitle,
    blocks,
    footerNote,
    audience = 'buyer',
  } = options;
  const foot = footerFor(audience);

  return `<!DOCTYPE html PUBLIC "-//W3C//DTD XHTML 1.0 Transitional//EN" "http://www.w3.org/TR/xhtml1/DTD/xhtml1-transitional.dtd">
<html xmlns="http://www.w3.org/1999/xhtml" lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width,initial-scale=1" />
<meta name="x-apple-disable-message-reformatting" />
<meta name="color-scheme" content="light" />
<meta name="supported-color-schemes" content="light" />
<title>${escapeHtml(title)}</title>
<style type="text/css">
  /* Clients that support <style> get the polish; the rest already have
     working inline styles on every element. Nothing here is load-bearing. */
  body { margin:0 !important; padding:0 !important; width:100% !important; }
  img { border:0; outline:none; text-decoration:none; -ms-interpolation-mode:bicubic; }
  /* No !important: the cards and panels override this inline with
     border-collapse:separate, which is what lets their rounded corners
     actually render. Collapse stays the default because it is what stops
     Outlook opening hairline gaps between cells. */
  table { border-collapse:collapse; }
  a { text-decoration:none; }
  /* Stops Apple Mail and some Android clients auto-linking dates, order
     references and phone numbers in their own blue. */
  a[x-apple-data-detectors], .unstyled a {
    color:inherit !important; text-decoration:none !important;
    font-size:inherit !important; font-family:inherit !important;
    font-weight:inherit !important; line-height:inherit !important;
  }
  @media only screen and (max-width:620px) {
    .wrap { width:100% !important; }
    .pad { padding-left:24px !important; padding-right:24px !important; }
    .pad-sm { padding-left:18px !important; padding-right:18px !important; }
    .h1 { font-size:26px !important; line-height:32px !important; }
    .stack { display:block !important; width:100% !important; }
    .btn a { display:block !important; text-align:center !important; }
    .hide-sm { display:none !important; }
  }
</style>
</head>
<body style="margin:0;padding:0;background:${THEME.canvas};">
<div style="display:none;font-size:1px;color:${THEME.canvas};line-height:1px;max-height:0;max-width:0;opacity:0;overflow:hidden;">${escapeHtml(preheader)}</div>
<!-- Some clients show the character after the preheader too; these push it out. -->
<div style="display:none;font-size:1px;color:${THEME.canvas};line-height:1px;max-height:0;max-width:0;opacity:0;overflow:hidden;">&#847;&zwnj;&nbsp;&#847;&zwnj;&nbsp;&#847;&zwnj;&nbsp;&#847;&zwnj;&nbsp;&#847;&zwnj;&nbsp;&#847;&zwnj;&nbsp;&#847;&zwnj;&nbsp;&#847;&zwnj;&nbsp;</div>

<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:${THEME.canvas};">
  <tr>
    <td align="center" style="padding:32px 12px;">

      <table role="presentation" class="wrap" width="600" cellpadding="0" cellspacing="0" border="0" style="width:600px;max-width:600px;background:${THEME.surface};border-radius:${THEME.radius};overflow:hidden;box-shadow:0 1px 3px rgba(15,23,42,0.06);">

        <!-- Header -->
        <tr>
          <td bgcolor="${THEME.gradientFallback}" style="background:${THEME.gradientFallback};background-image:${THEME.gradient};padding:28px 36px;" class="pad">
            <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
              <tr>
                <td align="left" style="vertical-align:middle;">
                  <!-- The wordmark is a purple gradient on transparent, so it
                       needs a light plate to read against the header. Alt text
                       carries the brand when images are blocked, which is the
                       default in a lot of clients. -->
                  <a href="${safeUrl(link('/'))}" style="text-decoration:none;">
                    <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="display:inline-block;background:#ffffff;border-radius:999px;">
                      <tr><td style="padding:9px 18px;line-height:0;">
                        <img src="${safeUrl(logoUrl())}" width="104" height="23" alt="Yukizi" style="display:block;width:104px;height:23px;" />
                      </td></tr>
                    </table>
                  </a>
                </td>
                <td align="right" class="hide-sm" style="vertical-align:middle;font-family:${THEME.font};font-size:11px;letter-spacing:0.1em;text-transform:uppercase;color:rgba(255,255,255,0.72);">
                  Anime &amp; Collectibles
                </td>
              </tr>
            </table>
          </td>
        </tr>

        <!-- Title block -->
        <tr>
          <td class="pad" style="padding:36px 36px 8px;font-family:${THEME.font};">
            ${
              eyebrow
                ? `<div style="font-size:11px;font-weight:700;letter-spacing:0.14em;text-transform:uppercase;color:${THEME.purple};padding-bottom:10px;">${escapeHtml(eyebrow)}</div>`
                : ''
            }
            <h1 class="h1" style="margin:0;font-size:29px;line-height:36px;font-weight:700;letter-spacing:-0.02em;color:${THEME.ink};">${escapeHtml(title)}</h1>
            ${
              subtitle
                ? `<p style="margin:12px 0 0;font-size:16px;line-height:25px;color:${THEME.body};">${escapeHtml(subtitle)}</p>`
                : ''
            }
          </td>
        </tr>

        ${blocks.join('\n')}

        <!-- Footer -->
        <tr>
          <td class="pad" style="padding:8px 36px 36px;">
            <div style="height:1px;line-height:1px;font-size:0;background:${THEME.border};margin:24px 0 20px;">&nbsp;</div>
            ${
              footerNote
                ? `<p style="margin:0 0 14px;font-family:${THEME.font};font-size:12px;line-height:19px;color:${THEME.faint};">${escapeHtml(footerNote)}</p>`
                : ''
            }
            <p style="margin:0 0 6px;font-family:${THEME.font};font-size:13px;line-height:21px;color:${THEME.body};">
              ${foot.help}
            </p>
            <p style="margin:0;font-family:${THEME.font};font-size:12px;line-height:20px;color:${THEME.faint};">
              ${foot.links
                .map(
                  (l) =>
                    `<a href="${safeUrl(l.href)}" style="color:${THEME.faint};">${escapeHtml(l.label)}</a>`,
                )
                .join('&nbsp;·&nbsp;')}
            </p>
          </td>
        </tr>
      </table>

      <p style="margin:18px 0 0;font-family:${THEME.font};font-size:11px;line-height:18px;color:${THEME.faint};text-align:center;max-width:600px;">
        ${escapeHtml(foot.why)}
      </p>

    </td>
  </tr>
</table>
</body>
</html>`;
}
