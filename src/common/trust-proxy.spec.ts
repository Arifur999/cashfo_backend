import { DEFAULT_TRUST_PROXY, parseTrustProxy } from './trust-proxy.js';

describe('parseTrustProxy', () => {
  it('trusts only local proxies when unset', () => {
    expect(parseTrustProxy(undefined)).toBe(DEFAULT_TRUST_PROXY);
    expect(parseTrustProxy('  ')).toBe(DEFAULT_TRUST_PROXY);
  });

  it('reads booleans and hop counts', () => {
    expect(parseTrustProxy('true')).toBe(true);
    expect(parseTrustProxy('false')).toBe(false);
    expect(parseTrustProxy('2')).toBe(2);
  });

  it('passes named ranges and address lists through for Express', () => {
    expect(parseTrustProxy('loopback, 10.0.0.0/8')).toBe('loopback, 10.0.0.0/8');
    expect(parseTrustProxy(' uniquelocal ')).toBe('uniquelocal');
  });
});
