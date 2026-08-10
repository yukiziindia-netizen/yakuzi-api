import { parseUa } from './ua';

const CHROME_WIN = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';
const SAFARI_IPHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1';
const CHROME_ANDROID = 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Mobile Safari/537.36';
const ANDROID_TABLET = 'Mozilla/5.0 (Linux; Android 13; SM-X700) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';
const EDGE_WIN = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36 Edg/126.0.0.0';
const SAMSUNG = 'Mozilla/5.0 (Linux; Android 13; SM-S918B) AppleWebKit/537.36 (KHTML, like Gecko) SamsungBrowser/25.0 Chrome/121.0.0.0 Mobile Safari/537.36';

describe('parseUa', () => {
  it('Chrome on Windows desktop', () => {
    expect(parseUa(CHROME_WIN)).toEqual({ deviceType: 'desktop', os: 'Windows', browser: 'Chrome', isBot: false });
  });

  it('Safari on iPhone is mobile/iOS', () => {
    expect(parseUa(SAFARI_IPHONE)).toEqual({ deviceType: 'mobile', os: 'iOS', browser: 'Safari', isBot: false });
  });

  it('Chrome on Android phone is mobile', () => {
    expect(parseUa(CHROME_ANDROID)).toMatchObject({ deviceType: 'mobile', os: 'Android', browser: 'Chrome' });
  });

  it('Android without Mobile token is a tablet', () => {
    expect(parseUa(ANDROID_TABLET)).toMatchObject({ deviceType: 'tablet', os: 'Android' });
  });

  it('Edge is not misread as Chrome', () => {
    expect(parseUa(EDGE_WIN).browser).toBe('Edge');
  });

  it('Samsung Internet is not misread as Chrome', () => {
    expect(parseUa(SAMSUNG).browser).toBe('Samsung Internet');
  });

  it.each([
    ['Mozilla/5.0 AppleWebKit/537.36 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)', 'Googlebot'],
    ['Mozilla/5.0 AppleWebKit/537.36 (compatible; GPTBot/1.0; +https://openai.com/gptbot)', 'GPTBot (OpenAI)'],
    ['Mozilla/5.0 (compatible; ClaudeBot/1.0; +claudebot@anthropic.com)', 'ClaudeBot (Anthropic)'],
    ['Mozilla/5.0 (compatible; PerplexityBot/1.0; +https://perplexity.ai/perplexitybot)', 'PerplexityBot'],
    ['Mozilla/5.0 (X11; Linux x86_64) HeadlessChrome/125.0.0.0', 'Headless browser'],
    ['python-requests/2.31.0', 'Python client'],
    ['curl/8.4.0', 'curl/wget'],
  ])('flags bots: %s', (ua, name) => {
    const parsed = parseUa(ua);
    expect(parsed.isBot).toBe(true);
    expect(parsed.botName).toBe(name);
  });

  it('empty UA is not a bot', () => {
    expect(parseUa('').isBot).toBe(false);
    expect(parseUa(null).isBot).toBe(false);
  });
});
