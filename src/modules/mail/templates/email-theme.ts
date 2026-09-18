/**
 * The storefront's design language, restated in the subset of CSS that email
 * clients actually honour.
 *
 * Every value here is lifted from apps/buyer's Tailwind config and globals.css
 * so a Yukizi email reads as the same brand as the site — same purple, same
 * orange accent, same Inter-first type stack, same corner radius. Keep them in
 * step: if the site's primary changes, change it here too.
 */
export const THEME = {
  /** primary-500 in tailwind.config.ts — the purple everything keys off. */
  purple: '#593696',
  purpleDark: '#3d236b',
  purpleDeep: '#2e1a52',
  /** The hero gradient the storefront uses on its primary surfaces. */
  gradient: 'linear-gradient(180deg,#8f5ad4 0%,#7745bd 48%,#5f2f9f 100%)',
  /** Flat stand-in wherever a gradient will not render (Outlook, mostly). */
  gradientFallback: '#7745bd',
  purpleTint: '#f5f3fa',
  purpleBorder: '#ebe6f5',

  /** secondary-500 — the orange used for accents and ratings. */
  orange: '#ff7536',
  orangeTint: '#fff5f0',

  ink: '#0f172a',
  body: '#475569',
  muted: '#64748b',
  faint: '#94a3b8',
  border: '#e2e8f0',
  surface: '#ffffff',
  canvas: '#f4f4f7',

  green: '#16a34a',
  greenTint: '#f0fdf4',
  red: '#dc2626',
  redTint: '#fef2f2',

  radius: '14px',
  radiusSm: '10px',

  /**
   * Inter first, to match the site, then the system stack. Webfonts are not
   * worth the weight or the privacy footprint in email — Inter renders for the
   * many people reading in a browser-based client that already has it.
   */
  font: "'Inter','Segoe UI',Roboto,Helvetica,Arial,sans-serif",
} as const;

/** Where the storefront lives. Overridable for staging. */
export function storefrontUrl(): string {
  return (process.env.STOREFRONT_URL || 'https://yukizi.com').replace(/\/$/, '');
}

/** Absolute storefront link from a path like `/orders`. */
export function link(path: string): string {
  const base = storefrontUrl();
  return path.startsWith('http')
    ? path
    : `${base}${path.startsWith('/') ? '' : '/'}${path}`;
}

export const SUPPORT_EMAIL = 'support@yukizi.com';

/**
 * The same URL the storefront serves its logo from.
 *
 * Remote images are blocked by default in plenty of clients, so nothing an
 * email needs to make sense may live only in an image — the wordmark is
 * repeated as alt text and every layout reads correctly with images off.
 */
export function logoUrl(): string {
  return `${storefrontUrl()}/YukiziLogo.png`;
}
