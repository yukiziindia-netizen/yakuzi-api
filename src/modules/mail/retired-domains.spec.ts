import { usableOwnAddress, isRetiredDomain } from './retired-domains';

/**
 * The dangerous half of this is not the rewrite — it is the scope. Rewriting
 * one of our own dead addresses is a fix; rewriting a customer's address would
 * send their order confirmation to a stranger. These pin the boundary.
 */
describe('retired mail domains', () => {
  describe('usableOwnAddress', () => {
    it('moves our own address onto the domain that receives mail', () => {
      expect(usableOwnAddress('support@yukizi.in')).toBe('support@yukizi.com');
    });

    it('keeps the mailbox, not just the domain', () => {
      expect(usableOwnAddress('alerts@yukizi.in')).toBe('alerts@yukizi.com');
      expect(usableOwnAddress('grievance@yukizi.in')).toBe('grievance@yukizi.com');
    });

    it('is case-insensitive about the domain', () => {
      expect(usableOwnAddress('Alerts@Yukizi.IN')).toBe('Alerts@yukizi.com');
    });

    it('leaves a working address untouched', () => {
      expect(usableOwnAddress('support@yukizi.com')).toBe('support@yukizi.com');
    });

    it('leaves an unrelated address exactly as configured', () => {
      // The guard stops a known-dead domain being used. It is not a rule that
      // everything must be @yukizi.com — an owner who points alerts at their
      // own inbox, or at a helpdesk, must keep getting them there.
      expect(usableOwnAddress('ops@example.com')).toBe('ops@example.com');
      expect(usableOwnAddress('rishi@gmail.com')).toBe('rishi@gmail.com');
    });

    it('matches the domain exactly, never as a suffix', () => {
      // notyukizi.in belongs to somebody else entirely.
      expect(usableOwnAddress('a@notyukizi.in')).toBe('a@notyukizi.in');
      // A subdomain we know nothing about may well have its own mail server.
      expect(usableOwnAddress('a@mail.yukizi.in')).toBe('a@mail.yukizi.in');
    });

    it('survives empty and malformed input rather than throwing', () => {
      expect(usableOwnAddress(undefined)).toBeUndefined();
      expect(usableOwnAddress('')).toBe('');
      expect(usableOwnAddress('   ')).toBe('');
      expect(usableOwnAddress('not-an-email')).toBe('not-an-email');
      expect(usableOwnAddress('@yukizi.in')).toBe('@yukizi.com');
    });
  });

  describe('isRetiredDomain', () => {
    it('recognises the dead domain and nothing else', () => {
      expect(isRetiredDomain('support@yukizi.in')).toBe(true);
      expect(isRetiredDomain('SUPPORT@YUKIZI.IN')).toBe(true);
      expect(isRetiredDomain('support@yukizi.com')).toBe(false);
      expect(isRetiredDomain('a@notyukizi.in')).toBe(false);
      expect(isRetiredDomain('a@mail.yukizi.in')).toBe(false);
    });

    it('is false for nothing, rather than throwing', () => {
      expect(isRetiredDomain(undefined)).toBe(false);
      expect(isRetiredDomain('')).toBe(false);
      expect(isRetiredDomain('no-at-sign')).toBe(false);
    });
  });
});
