import { AttributionLevel, SourceCategory } from '@prisma/client';

/**
 * Classifies raw acquisition evidence into an honest source label.
 *
 * Evidence priority (strongest wins):
 *   1. Ad click ids (gclid/fbclid/msclkid/ttclid)  -> PAID,   level CLICK_ID
 *   2. UTM parameters                              -> mapped, level UTM
 *   3. Referrer domain                             -> mapped, level REFERRER
 *   4. No referrer at all                          -> DIRECT, level DIRECT
 *
 * "DIRECT" strictly means "the browser provided no referrer information".
 * That includes typed URLs, bookmarks, most native apps, and some privacy
 * setups — it must never be presented as "typed the URL". A referrer whose
 * domain we do not recognize is REFERRAL (with the real domain preserved),
 * never silently dropped into DIRECT/UNKNOWN.
 */

export interface ClassifierInput {
  referrer?: string | null; // full URL or bare host
  utmSource?: string | null;
  utmMedium?: string | null;
  clickIds?: Partial<Record<'gclid' | 'fbclid' | 'msclkid' | 'ttclid', string>> | null;
}

export interface ClassifiedSource {
  /** Human label, e.g. "Google", "ChatGPT", "reddit.com" */
  source: string;
  category: SourceCategory;
  level: AttributionLevel;
  referrerDomain: string | null;
}

interface DomainRule {
  match: RegExp;
  source: string;
  category: SourceCategory;
}

// Order matters: first match wins. Keep AI above generic search
// (gemini.google.com must not fall through to Google Search).
const DOMAIN_RULES: DomainRule[] = [
  // ── AI assistants / answer engines ──
  { match: /(^|\.)chatgpt\.com$|(^|\.)chat\.openai\.com$/, source: 'ChatGPT', category: SourceCategory.AI },
  { match: /(^|\.)openai\.com$/, source: 'OpenAI', category: SourceCategory.AI },
  { match: /^gemini\.google\.com$|^bard\.google\.com$|^aistudio\.google\.com$/, source: 'Google Gemini', category: SourceCategory.AI },
  { match: /(^|\.)claude\.ai$|(^|\.)anthropic\.com$/, source: 'Claude', category: SourceCategory.AI },
  { match: /(^|\.)perplexity\.ai$/, source: 'Perplexity', category: SourceCategory.AI },
  { match: /^copilot\.microsoft\.com$|(^|\.)bing\.com\/chat$/, source: 'Microsoft Copilot', category: SourceCategory.AI },
  { match: /(^|\.)you\.com$/, source: 'You.com', category: SourceCategory.AI },
  { match: /(^|\.)phind\.com$/, source: 'Phind', category: SourceCategory.AI },
  { match: /(^|\.)poe\.com$/, source: 'Poe', category: SourceCategory.AI },
  { match: /(^|\.)meta\.ai$/, source: 'Meta AI', category: SourceCategory.AI },
  { match: /(^|\.)mistral\.ai$|(^|\.)lechat\.mistral\.ai$/, source: 'Mistral', category: SourceCategory.AI },
  { match: /(^|\.)grok\.com$|^grok\.x\.com$/, source: 'Grok', category: SourceCategory.AI },
  { match: /(^|\.)deepseek\.com$/, source: 'DeepSeek', category: SourceCategory.AI },

  // ── Search engines ──
  { match: /(^|\.)google\.[a-z.]+$/, source: 'Google', category: SourceCategory.ORGANIC_SEARCH },
  { match: /(^|\.)bing\.com$/, source: 'Bing', category: SourceCategory.ORGANIC_SEARCH },
  { match: /(^|\.)duckduckgo\.com$/, source: 'DuckDuckGo', category: SourceCategory.ORGANIC_SEARCH },
  { match: /(^|\.)search\.yahoo\.com$|(^|\.)yahoo\.com$/, source: 'Yahoo', category: SourceCategory.ORGANIC_SEARCH },
  { match: /(^|\.)search\.brave\.com$/, source: 'Brave Search', category: SourceCategory.ORGANIC_SEARCH },
  { match: /(^|\.)ecosia\.org$/, source: 'Ecosia', category: SourceCategory.ORGANIC_SEARCH },
  { match: /(^|\.)startpage\.com$/, source: 'Startpage', category: SourceCategory.ORGANIC_SEARCH },
  { match: /(^|\.)yandex\.(com|ru)$/, source: 'Yandex', category: SourceCategory.ORGANIC_SEARCH },
  { match: /(^|\.)baidu\.com$/, source: 'Baidu', category: SourceCategory.ORGANIC_SEARCH },

  // ── Video ──
  { match: /(^|\.)youtube\.com$|^youtu\.be$/, source: 'YouTube', category: SourceCategory.VIDEO },

  // ── Social ──
  { match: /(^|\.)instagram\.com$/, source: 'Instagram', category: SourceCategory.SOCIAL },
  { match: /(^|\.)facebook\.com$|^fb\.me$|^m\.facebook\.com$|^l\.facebook\.com$|^lm\.facebook\.com$/, source: 'Facebook', category: SourceCategory.SOCIAL },
  { match: /(^|\.)twitter\.com$|(^|\.)x\.com$|^t\.co$/, source: 'X (Twitter)', category: SourceCategory.SOCIAL },
  { match: /(^|\.)linkedin\.com$|^lnkd\.in$/, source: 'LinkedIn', category: SourceCategory.SOCIAL },
  { match: /(^|\.)reddit\.com$|^redd\.it$|^out\.reddit\.com$/, source: 'Reddit', category: SourceCategory.SOCIAL },
  { match: /(^|\.)pinterest\.[a-z.]+$|^pin\.it$/, source: 'Pinterest', category: SourceCategory.SOCIAL },
  { match: /(^|\.)tiktok\.com$/, source: 'TikTok', category: SourceCategory.SOCIAL },
  { match: /(^|\.)threads\.net$|(^|\.)threads\.com$/, source: 'Threads', category: SourceCategory.SOCIAL },
  { match: /(^|\.)snapchat\.com$/, source: 'Snapchat', category: SourceCategory.SOCIAL },

  // ── Messaging ──
  { match: /(^|\.)whatsapp\.com$|^wa\.me$|^web\.whatsapp\.com$/, source: 'WhatsApp', category: SourceCategory.MESSAGING },
  { match: /(^|\.)telegram\.(org|me)$|^t\.me$|^web\.telegram\.org$/, source: 'Telegram', category: SourceCategory.MESSAGING },

  // ── Mail providers (webmail referrers) ──
  { match: /^mail\.google\.com$|(^|\.)outlook\.(com|live\.com)$|^mail\.yahoo\.com$/, source: 'Email (webmail)', category: SourceCategory.EMAIL },
];

// android-app:// referrers map package names to sources.
const ANDROID_APP_RULES: Array<{ match: RegExp; source: string; category: SourceCategory }> = [
  { match: /googlequicksearchbox|^com\.google\.android\.gm$/, source: 'Google', category: SourceCategory.ORGANIC_SEARCH },
  { match: /com\.openai\.chatgpt/, source: 'ChatGPT', category: SourceCategory.AI },
  { match: /com\.google\.android\.apps\.bard/, source: 'Google Gemini', category: SourceCategory.AI },
  { match: /com\.instagram/, source: 'Instagram', category: SourceCategory.SOCIAL },
  { match: /com\.facebook/, source: 'Facebook', category: SourceCategory.SOCIAL },
  { match: /com\.twitter|com\.x\.android/, source: 'X (Twitter)', category: SourceCategory.SOCIAL },
  { match: /com\.linkedin/, source: 'LinkedIn', category: SourceCategory.SOCIAL },
  { match: /com\.reddit/, source: 'Reddit', category: SourceCategory.SOCIAL },
  { match: /com\.pinterest/, source: 'Pinterest', category: SourceCategory.SOCIAL },
  { match: /com\.whatsapp/, source: 'WhatsApp', category: SourceCategory.MESSAGING },
  { match: /org\.telegram/, source: 'Telegram', category: SourceCategory.MESSAGING },
  { match: /com\.zhiliaoapp\.musically|com\.ss\.android\.ugc/, source: 'TikTok', category: SourceCategory.SOCIAL },
];

// utm_source values seen in the wild, normalized to the same labels/categories.
const UTM_SOURCE_MAP: Record<string, { source: string; category: SourceCategory }> = {
  google: { source: 'Google', category: SourceCategory.ORGANIC_SEARCH },
  bing: { source: 'Bing', category: SourceCategory.ORGANIC_SEARCH },
  chatgpt: { source: 'ChatGPT', category: SourceCategory.AI },
  openai: { source: 'ChatGPT', category: SourceCategory.AI },
  gemini: { source: 'Google Gemini', category: SourceCategory.AI },
  claude: { source: 'Claude', category: SourceCategory.AI },
  perplexity: { source: 'Perplexity', category: SourceCategory.AI },
  copilot: { source: 'Microsoft Copilot', category: SourceCategory.AI },
  facebook: { source: 'Facebook', category: SourceCategory.SOCIAL },
  fb: { source: 'Facebook', category: SourceCategory.SOCIAL },
  instagram: { source: 'Instagram', category: SourceCategory.SOCIAL },
  ig: { source: 'Instagram', category: SourceCategory.SOCIAL },
  youtube: { source: 'YouTube', category: SourceCategory.VIDEO },
  twitter: { source: 'X (Twitter)', category: SourceCategory.SOCIAL },
  x: { source: 'X (Twitter)', category: SourceCategory.SOCIAL },
  linkedin: { source: 'LinkedIn', category: SourceCategory.SOCIAL },
  reddit: { source: 'Reddit', category: SourceCategory.SOCIAL },
  pinterest: { source: 'Pinterest', category: SourceCategory.SOCIAL },
  tiktok: { source: 'TikTok', category: SourceCategory.SOCIAL },
  whatsapp: { source: 'WhatsApp', category: SourceCategory.MESSAGING },
  telegram: { source: 'Telegram', category: SourceCategory.MESSAGING },
  email: { source: 'Email', category: SourceCategory.EMAIL },
  newsletter: { source: 'Email', category: SourceCategory.EMAIL },
};

const PAID_MEDIUMS = /^(cpc|ppc|cpm|cpv|cpa|paid|paidsocial|paid_social|paid-social|display|banner|retargeting)$/i;
const EMAIL_MEDIUMS = /^(email|e-mail|newsletter)$/i;
const SOCIAL_MEDIUMS = /^(social|social-network|social-media|sm)$/i;

/** Hostname (lowercased, no port/www) from a referrer URL or bare host. Null when unparseable. */
export function referrerDomain(referrer?: string | null): string | null {
  if (!referrer) return null;
  const raw = referrer.trim();
  if (!raw) return null;
  if (raw.startsWith('android-app://')) return raw.toLowerCase();
  try {
    const host = new URL(raw.includes('://') ? raw : `https://${raw}`).hostname.toLowerCase();
    return host.replace(/^www\./, '') || null;
  } catch {
    return null;
  }
}

export function classifySource(input: ClassifierInput): ClassifiedSource {
  const domain = referrerDomain(input.referrer);
  const utmSource = input.utmSource?.trim().toLowerCase() || null;
  const utmMedium = input.utmMedium?.trim().toLowerCase() || null;
  const clickIds = input.clickIds ?? {};

  // 1. Ad click ids — strongest paid evidence regardless of anything else.
  if (clickIds.gclid) return { source: 'Google Ads', category: SourceCategory.PAID, level: AttributionLevel.CLICK_ID, referrerDomain: domain };
  if (clickIds.fbclid) return { source: 'Meta Ads', category: SourceCategory.PAID, level: AttributionLevel.CLICK_ID, referrerDomain: domain };
  if (clickIds.msclkid) return { source: 'Microsoft Ads', category: SourceCategory.PAID, level: AttributionLevel.CLICK_ID, referrerDomain: domain };
  if (clickIds.ttclid) return { source: 'TikTok Ads', category: SourceCategory.PAID, level: AttributionLevel.CLICK_ID, referrerDomain: domain };

  // 2. UTM — campaign owner's own declaration.
  if (utmSource) {
    const mapped = UTM_SOURCE_MAP[utmSource];
    if (utmMedium && PAID_MEDIUMS.test(utmMedium)) {
      return { source: mapped ? `${mapped.source} (paid)` : `${utmSource} (paid)`, category: SourceCategory.PAID, level: AttributionLevel.UTM, referrerDomain: domain };
    }
    if (utmMedium && EMAIL_MEDIUMS.test(utmMedium)) {
      return { source: 'Email', category: SourceCategory.EMAIL, level: AttributionLevel.UTM, referrerDomain: domain };
    }
    if (mapped) return { source: mapped.source, category: mapped.category, level: AttributionLevel.UTM, referrerDomain: domain };
    if (utmMedium && SOCIAL_MEDIUMS.test(utmMedium)) {
      return { source: utmSource, category: SourceCategory.SOCIAL, level: AttributionLevel.UTM, referrerDomain: domain };
    }
    return { source: utmSource, category: SourceCategory.REFERRAL, level: AttributionLevel.UTM, referrerDomain: domain };
  }

  // 3. Referrer domain.
  if (domain) {
    if (domain.startsWith('android-app://')) {
      for (const rule of ANDROID_APP_RULES) {
        if (rule.match.test(domain)) {
          return { source: rule.source, category: rule.category, level: AttributionLevel.REFERRER, referrerDomain: domain };
        }
      }
      return { source: domain, category: SourceCategory.REFERRAL, level: AttributionLevel.REFERRER, referrerDomain: domain };
    }
    for (const rule of DOMAIN_RULES) {
      if (rule.match.test(domain)) {
        return { source: rule.source, category: rule.category, level: AttributionLevel.REFERRER, referrerDomain: domain };
      }
    }
    // Unrecognized but real referrer: keep the actual domain visible.
    return { source: domain, category: SourceCategory.REFERRAL, level: AttributionLevel.REFERRER, referrerDomain: domain };
  }

  // 4. No evidence at all.
  return { source: 'Direct', category: SourceCategory.DIRECT, level: AttributionLevel.DIRECT, referrerDomain: null };
}
