import { signCartRestore, verifyCartRestore } from './cart-restore.token';

/**
 * This token is the only thing standing between an emailed URL and somebody
 * else's cart, so the cases that matter are the ones where it must say no.
 */
describe('cart restore token', () => {
  const ORDER = '7f3c1a2b-0000-1111-2222-333344445555';
  const BUYER = 'aa11bb22-cccc-dddd-eeee-ff0011223344';

  beforeEach(() => {
    process.env.JWT_SECRET = 'test-secret-value';
  });

  it('accepts a token it just issued', () => {
    const token = signCartRestore(ORDER, BUYER);
    expect(verifyCartRestore(ORDER, BUYER, token)).toBe(true);
  });

  it('refuses the token against a different order', () => {
    const token = signCartRestore(ORDER, BUYER);
    expect(
      verifyCartRestore('99999999-0000-1111-2222-333344445555', BUYER, token),
    ).toBe(false);
  });

  it('refuses the token against a different buyer — one link, one cart', () => {
    const token = signCartRestore(ORDER, BUYER);
    expect(
      verifyCartRestore(ORDER, '00000000-cccc-dddd-eeee-ff0011223344', token),
    ).toBe(false);
  });

  it('refuses a tampered token', () => {
    const token = signCartRestore(ORDER, BUYER);
    const tampered = `${token.slice(0, -1)}${token.slice(-1) === 'A' ? 'B' : 'A'}`;
    expect(verifyCartRestore(ORDER, BUYER, tampered)).toBe(false);
  });

  it('refuses an empty or missing token rather than throwing', () => {
    expect(verifyCartRestore(ORDER, BUYER, '')).toBe(false);
    expect(verifyCartRestore(ORDER, BUYER, undefined as never)).toBe(false);
    expect(verifyCartRestore(ORDER, BUYER, 'not-even-close')).toBe(false);
  });

  it('stops honouring old tokens once the signing secret rotates', () => {
    const token = signCartRestore(ORDER, BUYER);
    process.env.JWT_SECRET = 'a-completely-different-secret';
    expect(verifyCartRestore(ORDER, BUYER, token)).toBe(false);
  });
});
