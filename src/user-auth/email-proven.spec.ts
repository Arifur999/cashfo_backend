import { emailProvenBy } from './user-auth.service.js';

const NOW = new Date('2026-11-02T06:00:00.000Z');
const day = (n: number) => new Date(NOW.getTime() - n * 86_400_000);

describe('a password reset by email link', () => {
  it('verifies the email', () => {
    expect(emailProvenBy({ emailVerifiedAt: null, phoneVerifiedAt: null }, NOW)).toEqual({ emailVerified: true, emailVerifiedAt: NOW });
    expect(emailProvenBy({ emailVerifiedAt: day(9), phoneVerifiedAt: null }, NOW)).toEqual({ emailVerified: true, emailVerifiedAt: day(9) });
  });

  it('takes off a phone verified before the email was, which may be whoever signed up with the address first', () => {
    expect(emailProvenBy({ emailVerifiedAt: null, phoneVerifiedAt: day(3) }, NOW)).toMatchObject({ phone: null, phoneVerifiedAt: null });
    expect(emailProvenBy({ emailVerifiedAt: day(2), phoneVerifiedAt: day(3) }, NOW)).toMatchObject({ phone: null, phoneVerifiedAt: null });
  });

  it('keeps a phone verified after the email', () => {
    expect(emailProvenBy({ emailVerifiedAt: day(5), phoneVerifiedAt: day(3) }, NOW)).not.toHaveProperty('phone');
  });
});
