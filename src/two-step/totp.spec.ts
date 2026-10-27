import { base32Decode, base32Encode, generateTotpSecret, groupSecret, hotp, matchTotp, otpauthUrl, totpAt, totpStep } from './totp.js';
import { challengeProblem, generateBackupCodes, hashBackupCode, MAX_CHALLENGE_ATTEMPTS, normalizeBackupCode, parseTrustedTokens } from './two-step-codes.js';

// RFC 6238 appendix B's SHA-1 key: the ASCII bytes of "12345678901234567890".
const RFC_SECRET = base32Encode(Buffer.from('12345678901234567890', 'ascii'));

describe('TOTP (RFC 6238)', () => {
  it('matches the RFC test vectors, as 6 digits', () => {
    // The RFC lists 8 digits; an authenticator shows the last 6.
    expect(totpAt(RFC_SECRET, 59 * 1000)).toBe('287082');
    expect(totpAt(RFC_SECRET, 1111111109 * 1000)).toBe('081804');
    expect(totpAt(RFC_SECRET, 1234567890 * 1000)).toBe('005924');
    expect(totpAt(RFC_SECRET, 2000000000 * 1000)).toBe('279037');
  });

  it('matches RFC 4226 HOTP for counter 0 and 1', () => {
    const key = Buffer.from('12345678901234567890', 'ascii');
    expect(hotp(key, 0)).toBe('755224');
    expect(hotp(key, 1)).toBe('287082');
  });

  it('round-trips base32 the way people type it', () => {
    const secret = generateTotpSecret();
    expect(secret).toMatch(/^[A-Z2-7]{32}$/);
    expect(base32Encode(base32Decode(groupSecret(secret).toLowerCase()))).toBe(secret);
    expect(groupSecret('JBSWY3DPEHPK3PXP')).toBe('JBSW Y3DP EHPK 3PXP');
    expect(() => base32Decode('not-base32!')).toThrow();
  });

  it('accepts one step either side of now, and no further', () => {
    const now = Date.UTC(2026, 9, 27, 10, 0, 15);
    const step = totpStep(now);
    const at = (offset: number) => totpAt(RFC_SECRET, (step + offset) * 30 * 1000);
    expect(matchTotp(RFC_SECRET, at(0), now)).toBe(step);
    expect(matchTotp(RFC_SECRET, at(-1), now)).toBe(step - 1);
    expect(matchTotp(RFC_SECRET, at(1), now)).toBe(step + 1);
    expect(matchTotp(RFC_SECRET, at(-2), now)).toBeNull();
    expect(matchTotp(RFC_SECRET, at(2), now)).toBeNull();
  });

  it('never accepts a step again once used (replay)', () => {
    const now = Date.UTC(2026, 9, 27, 10, 0, 15);
    const step = totpStep(now);
    const code = totpAt(RFC_SECRET, now);
    expect(matchTotp(RFC_SECRET, code, now, step - 1)).toBe(step);
    expect(matchTotp(RFC_SECRET, code, now, step)).toBeNull();
    // An older code from the window is refused after a newer one was used.
    expect(matchTotp(RFC_SECRET, totpAt(RFC_SECRET, now - 30 * 1000), now, step)).toBeNull();
  });

  it('ignores spaces and refuses anything but six digits', () => {
    const now = 1234567890 * 1000;
    expect(matchTotp(RFC_SECRET, '005 924', now)).not.toBeNull();
    expect(matchTotp(RFC_SECRET, '05924', now)).toBeNull();
    expect(matchTotp(RFC_SECRET, 'abcdef', now)).toBeNull();
  });

  it('builds the otpauth URL the QR code encodes', () => {
    const url = otpauthUrl('Money Tracker Admin', 'nadia@example.com', 'JBSWY3DPEHPK3PXP');
    expect(url).toBe(
      'otpauth://totp/Money%20Tracker%20Admin:nadia%40example.com?secret=JBSWY3DPEHPK3PXP&issuer=Money%20Tracker%20Admin&algorithm=SHA1&digits=6&period=30',
    );
  });
});

describe('two-step codes', () => {
  it('makes ten distinct backup codes like xxxx-xxxx with no look-alike characters', () => {
    const codes = generateBackupCodes();
    expect(codes).toHaveLength(10);
    expect(new Set(codes).size).toBe(10);
    for (const code of codes) expect(code).toMatch(/^[a-hj-km-np-z2-9]{4}-[a-hj-km-np-z2-9]{4}$/);
  });

  it('reads a backup code however it is typed', () => {
    expect(normalizeBackupCode(' K7M2-X9PQ ')).toBe('k7m2x9pq');
    expect(normalizeBackupCode('k7m2 x9pq')).toBe('k7m2x9pq');
    expect(normalizeBackupCode('k7m2-x9p')).toBeNull();
  });

  it('hashes backup codes per account and per server key', () => {
    const pepper = Buffer.alloc(32, 1);
    const hash = hashBackupCode(pepper, 'user-1', 'k7m2x9pq');
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
    expect(hashBackupCode(pepper, 'user-2', 'k7m2x9pq')).not.toBe(hash);
    expect(hashBackupCode(Buffer.alloc(32, 2), 'user-1', 'k7m2x9pq')).not.toBe(hash);
  });

  it('reads at most ten well-formed trusted-device tokens from the header', () => {
    const token = 'a'.repeat(43);
    expect(parseTrustedTokens(`${token}, bad token,${'b'.repeat(43)}`)).toEqual([token, 'b'.repeat(43)]);
    expect(parseTrustedTokens(undefined)).toEqual([]);
    expect(parseTrustedTokens(Array.from({ length: 12 }, (_, i) => `${'c'.repeat(42)}${i % 10}`).join(','))).toHaveLength(10);
  });

  it('ends a challenge when used, expired or out of tries', () => {
    const now = new Date('2026-10-27T10:00:00Z');
    const later = new Date('2026-10-27T10:05:00Z');
    expect(challengeProblem({ expiresAt: later, consumedAt: null, attempts: 0 }, now)).toBeNull();
    expect(challengeProblem({ expiresAt: later, consumedAt: now, attempts: 0 }, now)).toBe('CHALLENGE_EXPIRED');
    expect(challengeProblem({ expiresAt: now, consumedAt: null, attempts: 0 }, now)).toBe('CHALLENGE_EXPIRED');
    expect(challengeProblem({ expiresAt: later, consumedAt: null, attempts: MAX_CHALLENGE_ATTEMPTS }, now)).toBe('TOO_MANY_ATTEMPTS');
  });
});
