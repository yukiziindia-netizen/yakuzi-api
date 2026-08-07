import {
  computeSeoScore,
  computeAiVisibilityScore,
  computeReadabilityScore,
  faqCount,
} from './seo-scoring';

describe('faqCount', () => {
  it('counts only well-formed {question, answer} pairs', () => {
    expect(faqCount(null)).toBe(0);
    expect(faqCount('nope')).toBe(0);
    expect(
      faqCount([
        { question: 'Q1', answer: 'A1' },
        { question: '', answer: 'A2' },
        { question: 'Q3' },
        { question: 'Q4', answer: 'A4' },
      ]),
    ).toBe(2);
  });
});

describe('computeSeoScore', () => {
  it('is 0 for an empty record', () => {
    expect(computeSeoScore({})).toBe(0);
  });

  it('is 100 for a fully optimized record', () => {
    expect(
      computeSeoScore({
        title: 'Buy Goku Ultra Instinct Scale Figure Online', // 43 chars, contains keyword
        description:
          'Authentic Goku Ultra Instinct 1/7 scale figure with certificate, free shipping across India and easy returns on every order.', // 50–160
        focusKeyword: 'goku ultra instinct',
        secondaryKeywords: ['dragon ball figure'],
        entityDescription: 'A licensed Dragon Ball collectible figure.',
        faq: [{ question: 'Is it licensed?', answer: 'Yes, fully licensed.' }],
      }),
    ).toBe(100);
  });

  it('awards keyword-in-title only when the title contains the focus keyword', () => {
    const base = {
      title: 'Some Unrelated Product Name Here',
      focusKeyword: 'goku figure',
    };
    const withMatch = computeSeoScore({ ...base, title: 'Goku Figure Deluxe Edition' });
    const withoutMatch = computeSeoScore(base);
    expect(withMatch - withoutMatch).toBe(10);
  });

  it('does not award length bonuses outside the ideal ranges', () => {
    // 4-char title: presence points only, no length bonus
    const short = computeSeoScore({ title: 'Goku' });
    expect(short).toBe(20);
  });
});

describe('computeAiVisibilityScore', () => {
  it('is 0 for an empty record', () => {
    expect(computeAiVisibilityScore({})).toBe(0);
  });

  it('caps FAQ contribution at 5 entries', () => {
    const faq = Array.from({ length: 10 }, (_, i) => ({
      question: `Q${i}`,
      answer: `A${i}`,
    }));
    expect(computeAiVisibilityScore({ faq })).toBe(25);
  });

  it('reaches 100 when everything AI-relevant is present', () => {
    expect(
      computeAiVisibilityScore({
        aiSummary:
          'Yukizi sells authentic anime figures and collectibles from verified sellers across India, with buyer protection on every order.',
        entityDescription: 'Anime collectibles marketplace.',
        description:
          'Shop authentic anime figures, manga and pop-culture collectibles from verified sellers across India.',
        faq: Array.from({ length: 5 }, (_, i) => ({ question: `Q${i}`, answer: `A${i}` })),
      }),
    ).toBe(100);
  });
});

describe('computeReadabilityScore', () => {
  it('is null when there is no text at all', () => {
    expect(computeReadabilityScore({})).toBeNull();
  });

  it('scores simple text higher than dense jargon', () => {
    const simple = computeReadabilityScore({
      description: 'We sell toys. They are fun. Kids love them. Buy one today.',
    });
    const dense = computeReadabilityScore({
      description:
        'Organizational procurement methodologies necessitate comprehensive infrastructural rationalization initiatives incorporating multidimensional stakeholder considerations.',
    });
    expect(simple).not.toBeNull();
    expect(dense).not.toBeNull();
    expect(simple as number).toBeGreaterThan(dense as number);
  });

  it('clamps into the 0–100 range', () => {
    const score = computeReadabilityScore({ description: 'Go. Do. Be. So. No. Yo.' });
    expect(score).toBeGreaterThanOrEqual(0);
    expect(score).toBeLessThanOrEqual(100);
  });
});
