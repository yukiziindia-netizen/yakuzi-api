/**
 * Minimal dependency-free user-agent classification: enough for analytics
 * breakdowns (device / OS / browser families), not a full parser. Order of
 * checks matters throughout — e.g. Edge contains "Chrome", Chrome contains
 * "Safari", Android contains "Linux".
 */

export interface ParsedUa {
  deviceType: 'desktop' | 'mobile' | 'tablet';
  os: string;
  browser: string;
  isBot: boolean;
  /** Set only when isBot — the crawler family for the Traffic Quality report. */
  botName?: string;
}

// AI crawlers listed explicitly: they must land in the BOT bucket, never be
// mistaken for human "AI traffic" (that requires a human browser + AI referrer).
const BOT_PATTERNS: Array<{ match: RegExp; name: string }> = [
  { match: /gptbot/i, name: 'GPTBot (OpenAI)' },
  { match: /oai-searchbot/i, name: 'OAI-SearchBot (OpenAI)' },
  { match: /chatgpt-user/i, name: 'ChatGPT-User (OpenAI)' },
  { match: /claudebot|claude-web|anthropic-ai/i, name: 'ClaudeBot (Anthropic)' },
  { match: /perplexitybot/i, name: 'PerplexityBot' },
  { match: /google-extended/i, name: 'Google-Extended' },
  { match: /googlebot/i, name: 'Googlebot' },
  { match: /bingbot/i, name: 'Bingbot' },
  { match: /duckduckbot/i, name: 'DuckDuckBot' },
  { match: /yandexbot/i, name: 'YandexBot' },
  { match: /baiduspider/i, name: 'Baiduspider' },
  { match: /ahrefsbot/i, name: 'AhrefsBot' },
  { match: /semrushbot/i, name: 'SemrushBot' },
  { match: /mj12bot/i, name: 'MJ12bot' },
  { match: /facebookexternalhit|meta-externalagent/i, name: 'Facebook crawler' },
  { match: /twitterbot/i, name: 'Twitterbot' },
  { match: /linkedinbot/i, name: 'LinkedInBot' },
  { match: /whatsapp/i, name: 'WhatsApp preview' },
  { match: /telegrambot/i, name: 'TelegramBot' },
  { match: /applebot/i, name: 'Applebot' },
  { match: /bytespider/i, name: 'Bytespider' },
  { match: /amazonbot/i, name: 'Amazonbot' },
  { match: /petalbot/i, name: 'PetalBot' },
  { match: /headlesschrome|phantomjs|puppeteer|playwright|selenium/i, name: 'Headless browser' },
  { match: /python-requests|python-urllib|aiohttp|httpx/i, name: 'Python client' },
  { match: /axios|node-fetch|got \(|undici/i, name: 'Node client' },
  { match: /curl\/|wget\//i, name: 'curl/wget' },
  { match: /\b(bot|crawler|spider|crawling|scraper)\b/i, name: 'Generic bot' },
];

export function parseUa(ua: string | null | undefined): ParsedUa {
  const s = (ua ?? '').trim();
  if (!s) return { deviceType: 'desktop', os: 'Unknown', browser: 'Unknown', isBot: false };

  for (const bot of BOT_PATTERNS) {
    if (bot.match.test(s)) {
      return { deviceType: 'desktop', os: 'Bot', browser: bot.name, isBot: true, botName: bot.name };
    }
  }

  // Device type: iPad before iPhone/Android; Android tablets lack "Mobile".
  let deviceType: ParsedUa['deviceType'] = 'desktop';
  if (/ipad|tablet|kindle|silk|playbook/i.test(s) || (/android/i.test(s) && !/mobile/i.test(s))) deviceType = 'tablet';
  else if (/iphone|ipod|android.*mobile|windows phone|blackberry|opera mini/i.test(s)) deviceType = 'mobile';
  // Modern iPadOS reports as "Macintosh" + touch; not detectable from UA alone — counted as desktop, documented.

  let os = 'Other';
  if (/windows nt/i.test(s)) os = 'Windows';
  else if (/iphone|ipad|ipod/i.test(s)) os = 'iOS';
  else if (/android/i.test(s)) os = 'Android';
  else if (/mac os x|macintosh/i.test(s)) os = 'macOS';
  else if (/cros/i.test(s)) os = 'ChromeOS';
  else if (/linux/i.test(s)) os = 'Linux';

  let browser = 'Other';
  if (/edg(e|a|ios)?\//i.test(s)) browser = 'Edge';
  else if (/samsungbrowser\//i.test(s)) browser = 'Samsung Internet';
  else if (/opr\/|opera/i.test(s)) browser = 'Opera';
  else if (/firefox\/|fxios\//i.test(s)) browser = 'Firefox';
  else if (/crios\//i.test(s)) browser = 'Chrome'; // Chrome on iOS
  else if (/chrome\//i.test(s)) browser = 'Chrome';
  else if (/safari\//i.test(s) && /version\//i.test(s)) browser = 'Safari';
  else if (/instagram/i.test(s)) browser = 'Instagram in-app';
  else if (/fbav|fb_iab/i.test(s)) browser = 'Facebook in-app';

  return { deviceType, os, browser, isBot: false };
}
