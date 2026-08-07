import { redactEmail } from './redact-email';

describe('redactEmail', () => {
  it('keeps only the first character of the local part', () => {
    expect(redactEmail('arko@gmail.com')).toBe('a***@gmail.com');
  });

  it('returns a fully masked value when there is no domain', () => {
    expect(redactEmail('not-an-email')).toBe('***');
  });

  it('tolerates null and undefined', () => {
    expect(redactEmail(null as unknown as string)).toBe('***');
    expect(redactEmail(undefined as unknown as string)).toBe('***');
  });
});
