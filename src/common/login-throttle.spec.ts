import { accountTracker } from './login-throttle.js';

const bucket = (email: unknown) => (accountTracker as unknown as (req: object) => string)({ ip: '1.2.3.4', body: { email } });

describe('accountTracker', () => {
  it('counts every spelling of one phone number in one bucket', () => {
    const spellings = ['01712345678', '+8801712345678', '8801712345678', '017-1234-5678', '017 1234 5678'];
    expect(new Set(spellings.map(bucket)).size).toBe(1);
  });

  it('keeps an email or a username as typed, lowercased', () => {
    expect(bucket(' Nusrat@Example.com ')).toBe('1.2.3.4|nusrat@example.com');
    expect(bucket('rakib.m')).toBe('1.2.3.4|rakib.m');
    expect(bucket(undefined)).toBe('1.2.3.4|');
  });
});
