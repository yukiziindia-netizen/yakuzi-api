import { AttributionLevel, SourceCategory } from '@prisma/client';
import { classifySource, referrerDomain } from './source-classifier';

describe('referrerDomain', () => {
  it.each([
    ['https://www.google.com/search?q=x', 'google.com'],
    ['https://chatgpt.com/', 'chatgpt.com'],
    ['http://m.facebook.com/story', 'm.facebook.com'],
    ['gemini.google.com', 'gemini.google.com'],
    ['android-app://com.google.android.googlequicksearchbox/', 'android-app://com.google.android.googlequicksearchbox/'],
    ['', null],
    [null, null],
    ['::::not a url::::', null],
  ])('%s -> %s', (input, expected) => {
    expect(referrerDomain(input as string | null)).toBe(expected);
  });
});

describe('classifySource', () => {
  const cases: Array<{
    name: string;
    input: Parameters<typeof classifySource>[0];
    source: string;
    category: SourceCategory;
    level: AttributionLevel;
  }> = [
    // AI referrers — the platforms Rishi cares most about
    { name: 'ChatGPT web', input: { referrer: 'https://chatgpt.com/' }, source: 'ChatGPT', category: SourceCategory.AI, level: AttributionLevel.REFERRER },
    { name: 'ChatGPT legacy domain', input: { referrer: 'https://chat.openai.com/c/abc' }, source: 'ChatGPT', category: SourceCategory.AI, level: AttributionLevel.REFERRER },
    { name: 'Gemini', input: { referrer: 'https://gemini.google.com/app' }, source: 'Google Gemini', category: SourceCategory.AI, level: AttributionLevel.REFERRER },
    { name: 'Claude', input: { referrer: 'https://claude.ai/chat/x' }, source: 'Claude', category: SourceCategory.AI, level: AttributionLevel.REFERRER },
    { name: 'Perplexity', input: { referrer: 'https://www.perplexity.ai/search' }, source: 'Perplexity', category: SourceCategory.AI, level: AttributionLevel.REFERRER },
    { name: 'Copilot', input: { referrer: 'https://copilot.microsoft.com/' }, source: 'Microsoft Copilot', category: SourceCategory.AI, level: AttributionLevel.REFERRER },

    // gemini.google.com must NOT be swallowed by the generic google rule
    { name: 'Google search', input: { referrer: 'https://www.google.com/' }, source: 'Google', category: SourceCategory.ORGANIC_SEARCH, level: AttributionLevel.REFERRER },
    { name: 'Google India', input: { referrer: 'https://www.google.co.in/url' }, source: 'Google', category: SourceCategory.ORGANIC_SEARCH, level: AttributionLevel.REFERRER },
    { name: 'Bing', input: { referrer: 'https://www.bing.com/search' }, source: 'Bing', category: SourceCategory.ORGANIC_SEARCH, level: AttributionLevel.REFERRER },
    { name: 'DuckDuckGo', input: { referrer: 'https://duckduckgo.com/' }, source: 'DuckDuckGo', category: SourceCategory.ORGANIC_SEARCH, level: AttributionLevel.REFERRER },

    // Social & video & messaging
    { name: 'Instagram', input: { referrer: 'https://l.instagram.com/' }, source: 'Instagram', category: SourceCategory.SOCIAL, level: AttributionLevel.REFERRER },
    { name: 'Facebook mobile', input: { referrer: 'https://m.facebook.com/' }, source: 'Facebook', category: SourceCategory.SOCIAL, level: AttributionLevel.REFERRER },
    { name: 'X shortener', input: { referrer: 'https://t.co/abc' }, source: 'X (Twitter)', category: SourceCategory.SOCIAL, level: AttributionLevel.REFERRER },
    { name: 'YouTube', input: { referrer: 'https://www.youtube.com/watch' }, source: 'YouTube', category: SourceCategory.VIDEO, level: AttributionLevel.REFERRER },
    { name: 'Reddit outbound', input: { referrer: 'https://out.reddit.com/' }, source: 'Reddit', category: SourceCategory.SOCIAL, level: AttributionLevel.REFERRER },
    { name: 'WhatsApp', input: { referrer: 'https://wa.me/' }, source: 'WhatsApp', category: SourceCategory.MESSAGING, level: AttributionLevel.REFERRER },
    { name: 'Telegram t.me', input: { referrer: 'https://t.me/channel' }, source: 'Telegram', category: SourceCategory.MESSAGING, level: AttributionLevel.REFERRER },

    // t.co must not be confused with t.me
    { name: 'Android Google app', input: { referrer: 'android-app://com.google.android.googlequicksearchbox/' }, source: 'Google', category: SourceCategory.ORGANIC_SEARCH, level: AttributionLevel.REFERRER },
    { name: 'Android Instagram app', input: { referrer: 'android-app://com.instagram.android' }, source: 'Instagram', category: SourceCategory.SOCIAL, level: AttributionLevel.REFERRER },

    // Unknown referrer keeps the real domain, category REFERRAL — never DIRECT
    { name: 'Unknown blog', input: { referrer: 'https://some-anime-blog.example.net/post' }, source: 'some-anime-blog.example.net', category: SourceCategory.REFERRAL, level: AttributionLevel.REFERRER },

    // UTM beats referrer
    { name: 'UTM instagram over google referrer', input: { referrer: 'https://google.com', utmSource: 'instagram' }, source: 'Instagram', category: SourceCategory.SOCIAL, level: AttributionLevel.UTM },
    { name: 'UTM chatgpt', input: { utmSource: 'chatgpt' }, source: 'ChatGPT', category: SourceCategory.AI, level: AttributionLevel.UTM },
    { name: 'UTM paid medium', input: { utmSource: 'google', utmMedium: 'cpc' }, source: 'Google (paid)', category: SourceCategory.PAID, level: AttributionLevel.UTM },
    { name: 'UTM email medium', input: { utmSource: 'mailchimp', utmMedium: 'email' }, source: 'Email', category: SourceCategory.EMAIL, level: AttributionLevel.UTM },
    { name: 'UTM unknown source', input: { utmSource: 'partner-site' }, source: 'partner-site', category: SourceCategory.REFERRAL, level: AttributionLevel.UTM },

    // Click ids beat everything
    { name: 'gclid', input: { referrer: 'https://google.com', utmSource: 'google', clickIds: { gclid: 'x' } }, source: 'Google Ads', category: SourceCategory.PAID, level: AttributionLevel.CLICK_ID },
    { name: 'fbclid', input: { referrer: 'https://l.facebook.com', clickIds: { fbclid: 'y' } }, source: 'Meta Ads', category: SourceCategory.PAID, level: AttributionLevel.CLICK_ID },

    // No evidence at all
    { name: 'no referrer = Direct', input: {}, source: 'Direct', category: SourceCategory.DIRECT, level: AttributionLevel.DIRECT },
  ];

  it.each(cases.map((c) => [c.name, c] as const))('%s', (_label, c) => {
    const result = classifySource(c.input);
    expect(result.source).toBe(c.source);
    expect(result.category).toBe(c.category);
    expect(result.level).toBe(c.level);
  });

  it('keeps the raw referrer domain for drill-down even when UTM wins', () => {
    const r = classifySource({ referrer: 'https://news.ycombinator.com/item', utmSource: 'instagram' });
    expect(r.referrerDomain).toBe('news.ycombinator.com');
  });
});
