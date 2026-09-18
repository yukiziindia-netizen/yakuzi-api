import { THEME } from './email-theme';
import { escapeHtml, safeUrl } from './email-layout';

/**
 * The pieces emails are assembled from.
 *
 * Each returns one `<tr>` for the 600px table in email-layout.ts, so a message
 * body is a list of these. Adding a new kind of email should mean picking
 * blocks, not writing table markup.
 */

const PAD = `padding:0 36px;`;

/** Body copy. `html` is trusted — pass escaped strings only. */
export function paragraph(html: string, opts: { top?: number; size?: number; color?: string } = {}): string {
  const { top = 16, size = 15, color = THEME.body } = opts;
  return `<tr><td class="pad" style="${PAD}font-family:${THEME.font};">
    <p style="margin:${top}px 0 0;font-size:${size}px;line-height:${Math.round(size * 1.62)}px;color:${color};">${html}</p>
  </td></tr>`;
}

/**
 * The primary call to action.
 *
 * Built from padding rather than a fixed height so it grows with the label,
 * and left-aligned to sit with the copy — on narrow screens the media query in
 * the layout stretches it to full width.
 */
export function button(label: string, url: string, opts: { top?: number; tone?: 'purple' | 'orange' } = {}): string {
  const { top = 26, tone = 'purple' } = opts;
  const bg = tone === 'orange' ? THEME.orange : THEME.purple;
  return `<tr><td class="pad" style="${PAD}padding-top:${top}px;">
    <table role="presentation" cellpadding="0" cellspacing="0" border="0" class="btn"><tr>
      <td bgcolor="${bg}" style="background:${bg};border-radius:999px;border-collapse:separate;">
        <a href="${safeUrl(url)}" style="display:inline-block;padding:15px 34px;font-family:${THEME.font};font-size:15px;font-weight:600;letter-spacing:0.01em;color:#ffffff;border-radius:999px;">${escapeHtml(label)}</a>
      </td>
    </tr></table>
  </td></tr>`;
}

/** A quieter second action under the button. */
export function textLink(label: string, url: string, opts: { top?: number } = {}): string {
  const { top = 14 } = opts;
  return `<tr><td class="pad" style="${PAD}padding-top:${top}px;font-family:${THEME.font};">
    <a href="${safeUrl(url)}" style="font-size:14px;font-weight:600;color:${THEME.purple};">${escapeHtml(label)} &rarr;</a>
  </td></tr>`;
}

/**
 * A tinted card for the one fact the reader most needs — an amount refunded, a
 * reference number, what happens next.
 */
export function panel(
  rows: { label: string; value: string }[],
  opts: { tone?: 'purple' | 'green' | 'orange' | 'plain'; top?: number; title?: string } = {},
): string {
  const { tone = 'purple', top = 24, title } = opts;
  const tones = {
    purple: { bg: THEME.purpleTint, border: THEME.purpleBorder, key: THEME.purple },
    green: { bg: THEME.greenTint, border: '#bbf7d0', key: THEME.green },
    orange: { bg: THEME.orangeTint, border: '#ffd0b8', key: '#c2410c' },
    plain: { bg: '#f8fafc', border: THEME.border, key: THEME.ink },
  }[tone];

  const body = rows
    .map(
      (r, i) =>
        `<tr>
          <td style="padding:${i === 0 ? '0' : '9px'} 14px 0 0;font-family:${THEME.font};font-size:13px;line-height:20px;color:${THEME.muted};white-space:nowrap;">${escapeHtml(r.label)}</td>
          <td align="right" style="padding:${i === 0 ? '0' : '9px'} 0 0;font-family:${THEME.font};font-size:14px;line-height:20px;font-weight:600;color:${THEME.ink};">${escapeHtml(r.value)}</td>
        </tr>`,
    )
    .join('');

  return `<tr><td class="pad" style="${PAD}padding-top:${top}px;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:${tones.bg};border:1px solid ${tones.border};border-radius:${THEME.radiusSm};border-collapse:separate;">
      <tr><td style="padding:18px 20px;">
        ${
          title
            ? `<div style="font-family:${THEME.font};font-size:11px;font-weight:700;letter-spacing:0.12em;text-transform:uppercase;color:${tones.key};padding-bottom:12px;">${escapeHtml(title)}</div>`
            : ''
        }
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">${body}</table>
      </td></tr>
    </table>
  </td></tr>`;
}

export interface ProductLine {
  name: string;
  /** Absolute image URL, or null — the card falls back to a lettered tile. */
  imageUrl?: string | null;
  /** Where the name and image link to. */
  url: string;
  /** e.g. "Qty 2" or "₹1,299". */
  meta?: string;
  /** Right-hand column, usually the line price. */
  amount?: string;
}

/**
 * The product cards — the part that makes a Yukizi email look like Yukizi.
 *
 * Fixed-width image cell with a tinted placeholder behind it, so a blocked or
 * slow image leaves a branded tile rather than a broken-image icon.
 */
export function productList(items: ProductLine[], opts: { top?: number } = {}): string {
  if (items.length === 0) return '';
  const { top = 26 } = opts;

  const cards = items
    .map(
      (item) => `
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border:1px solid ${THEME.border};border-radius:${THEME.radiusSm};border-collapse:separate;margin-bottom:10px;">
        <tr>
          <td width="76" style="width:76px;padding:12px 0 12px 12px;vertical-align:top;">
            <a href="${safeUrl(item.url)}" style="text-decoration:none;">
              <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="background:${THEME.purpleTint};border-radius:8px;border-collapse:separate;">
                <tr><td align="center" width="64" height="64" style="width:64px;height:64px;text-align:center;font-family:${THEME.font};font-size:20px;font-weight:700;color:${THEME.purple};">
                  ${
                    item.imageUrl
                      ? `<img src="${safeUrl(item.imageUrl)}" width="64" height="64" alt="" style="display:block;width:64px;height:64px;border-radius:8px;object-fit:cover;" />`
                      : escapeHtml((item.name || '?').trim().charAt(0).toUpperCase())
                  }
                </td></tr>
              </table>
            </a>
          </td>
          <td style="padding:14px 14px 14px 14px;vertical-align:top;font-family:${THEME.font};">
            <a href="${safeUrl(item.url)}" style="font-size:14px;line-height:21px;font-weight:600;color:${THEME.ink};">${escapeHtml(item.name)}</a>
            ${
              item.meta
                ? `<div style="padding-top:5px;font-size:13px;line-height:19px;color:${THEME.muted};">${escapeHtml(item.meta)}</div>`
                : ''
            }
          </td>
          ${
            item.amount
              ? `<td align="right" style="padding:14px 16px 14px 0;vertical-align:top;font-family:${THEME.font};font-size:14px;font-weight:700;color:${THEME.ink};white-space:nowrap;">${escapeHtml(item.amount)}</td>`
              : ''
          }
        </tr>
      </table>`,
    )
    .join('');

  return `<tr><td class="pad" style="${PAD}padding-top:${top}px;">${cards}</td></tr>`;
}

/**
 * Numbered "what happens next" steps. Reassurance, in the places where the
 * reader's next question is "and then what?".
 */
export function steps(items: string[], opts: { top?: number; title?: string } = {}): string {
  const { top = 24, title } = opts;
  const rows = items
    .map(
      (text, i) => `
      <tr>
        <td width="26" style="width:26px;padding:${i === 0 ? '0' : '12px'} 12px 0 0;vertical-align:top;">
          <table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr>
            <td align="center" width="22" height="22" style="width:22px;height:22px;background:${THEME.purple};border-radius:11px;border-collapse:separate;font-family:${THEME.font};font-size:11px;font-weight:700;color:#ffffff;text-align:center;line-height:22px;">${i + 1}</td>
          </tr></table>
        </td>
        <td style="padding:${i === 0 ? '0' : '12px'} 0 0;font-family:${THEME.font};font-size:14px;line-height:22px;color:${THEME.body};vertical-align:top;">${escapeHtml(text)}</td>
      </tr>`,
    )
    .join('');

  return `<tr><td class="pad" style="${PAD}padding-top:${top}px;">
    ${
      title
        ? `<div style="font-family:${THEME.font};font-size:11px;font-weight:700;letter-spacing:0.12em;text-transform:uppercase;color:${THEME.muted};padding-bottom:14px;">${escapeHtml(title)}</div>`
        : ''
    }
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">${rows}</table>
  </td></tr>`;
}

/** Someone else's words, set apart — used for a support reply. */
export function quote(body: string, attribution: string, opts: { top?: number } = {}): string {
  const { top = 24 } = opts;
  return `<tr><td class="pad" style="${PAD}padding-top:${top}px;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#f8fafc;border-left:3px solid ${THEME.purple};border-radius:0 ${THEME.radiusSm} ${THEME.radiusSm} 0;border-collapse:separate;">
      <tr><td style="padding:18px 20px;font-family:${THEME.font};">
        <div style="font-size:15px;line-height:24px;color:${THEME.ink};white-space:pre-wrap;">${escapeHtml(body)}</div>
        <div style="padding-top:12px;font-size:12px;color:${THEME.muted};">${escapeHtml(attribution)}</div>
      </td></tr>
    </table>
  </td></tr>`;
}

/** Five stars, as a visual prompt above a review link. */
export function starRow(opts: { top?: number } = {}): string {
  const { top = 22 } = opts;
  return `<tr><td class="pad" style="${PAD}padding-top:${top}px;font-family:${THEME.font};font-size:30px;line-height:34px;letter-spacing:6px;color:${THEME.orange};">
    &#9733;&#9733;&#9733;&#9733;&#9733;
  </td></tr>`;
}

/** Vertical breathing room where a block boundary is not enough. */
export function spacer(height = 8): string {
  return `<tr><td style="height:${height}px;line-height:${height}px;font-size:0;">&nbsp;</td></tr>`;
}

/** Formats paise-accurate rupee amounts the way the storefront does. */
export function rupees(amount: number): string {
  return `₹${Number(amount || 0).toLocaleString('en-IN', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}
