import { countryOfIp, placeOfIp } from './ip-country.js';

describe('countryOfIp', () => {
  it('names the country of a public address', () => {
    expect(countryOfIp('103.4.145.1')).toBe('Bangladesh');
    expect(countryOfIp('8.8.8.8')).toBe('United States');
    expect(countryOfIp('::ffff:8.8.8.8')).toBe('United States');
    expect(countryOfIp('2001:4860:4860::8888')).toBe('United States');
  });

  it('says Unknown for what it cannot place', () => {
    expect(countryOfIp('127.0.0.1')).toBe('Unknown');
    expect(countryOfIp('10.0.0.5')).toBe('Unknown');
    expect(countryOfIp('unknown')).toBe('Unknown');
    expect(countryOfIp('x'.repeat(10_000))).toBe('Unknown');
    expect(countryOfIp(null)).toBe('Unknown');
  });
});

describe('placeOfIp', () => {
  it('names the country, or nothing when it cannot', () => {
    expect(placeOfIp('103.4.145.1')).toBe('Bangladesh');
    expect(placeOfIp('10.0.0.5')).toBeNull();
  });
});
