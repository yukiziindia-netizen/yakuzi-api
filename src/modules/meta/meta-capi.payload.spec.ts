import { createHash } from 'crypto';
import { hashIdentifier, buildPurchaseEvent, buildRequestBody } from './meta-capi.payload';

const sha = (v: string) => createHash('sha256').update(v).digest('hex');

describe('hashIdentifier', () => {
  it('lower-cases and trims an email before hashing', () => {
    expect(hashIdentifier('  Rishi@Example.COM ', 'email')).toBe(sha('rishi@example.com'));
  });

  it('reduces a phone to digits and adds the 91 country code for a bare 10-digit number', () => {
    expect(hashIdentifier('+91 82912 80021', 'phone')).toBe(sha('918291280021'));
    expect(hashIdentifier('8291280021', 'phone')).toBe(sha('918291280021'));
    expect(hashIdentifier('091-8291280021', 'phone')).toBe(sha('918291280021'));
  });

  it('returns undefined for nothing to hash', () => {
    expect(hashIdentifier('', 'email')).toBeUndefined();
    expect(hashIdentifier(null, 'phone')).toBeUndefined();
    expect(hashIdentifier(undefined, 'text')).toBeUndefined();
  });

  it('never emits a raw identifier', () => {
    const h = hashIdentifier('rishi@example.com', 'email')!;
    expect(h).not.toContain('rishi');
    expect(h).toMatch(/^[a-f0-9]{64}$/);
  });
});

describe('buildPurchaseEvent', () => {
  const base = {
    eventId: 'order-123',
    eventTimeSeconds: 1_700_000_000,
    email: 'rishi@example.com',
    phone: '8291280021',
    userId: 'user-1',
    value: 1044.164,
    currency: 'INR',
  };

  it('produces a deduplicable Purchase with hashed identifiers', () => {
    const e = buildPurchaseEvent(base);
    expect(e.event_name).toBe('Purchase');
    expect(e.event_id).toBe('order-123');
    expect(e.action_source).toBe('website');
    const ud = e.user_data as Record<string, unknown>;
    expect(ud.em).toEqual([sha('rishi@example.com')]);
    expect(ud.ph).toEqual([sha('918291280021')]);
    expect(ud.external_id).toEqual([sha('user-1')]);
    const cd = e.custom_data as Record<string, unknown>;
    expect(cd).toEqual({ currency: 'INR', value: 1044.16 }); // rounded to paise
  });

  it('omits identifiers it does not have rather than sending blanks', () => {
    const e = buildPurchaseEvent({ ...base, phone: null, userId: null });
    const ud = e.user_data as Record<string, unknown>;
    expect(ud.em).toBeDefined();
    expect(ud.ph).toBeUndefined();
    expect(ud.external_id).toBeUndefined();
  });

  it('passes browser signals through unhashed for match quality', () => {
    const e = buildPurchaseEvent({ ...base, fbp: 'fb.1.x', fbc: 'fb.1.y', clientIp: '1.2.3.4', clientUserAgent: 'UA' });
    const ud = e.user_data as Record<string, unknown>;
    expect(ud.fbp).toBe('fb.1.x');
    expect(ud.client_ip_address).toBe('1.2.3.4');
    expect(ud.client_user_agent).toBe('UA');
  });
});

describe('buildRequestBody', () => {
  it('includes the test event code only when set', () => {
    expect(buildRequestBody([{ a: 1 }])).toEqual({ data: [{ a: 1 }] });
    expect(buildRequestBody([{ a: 1 }], 'TEST123')).toEqual({ data: [{ a: 1 }], test_event_code: 'TEST123' });
  });
});
