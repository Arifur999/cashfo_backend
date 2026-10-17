import { failedSignInsDescription, type KnownAccount, pausedNetworks, signedInAfter } from './security-extras.js';

const at = (hour: number, minute: number) => new Date(Date.UTC(2026, 9, 2, hour, minute));

describe('failedSignInsDescription', () => {
  const accounts = new Map<string, KnownAccount>([
    ['nadia@example.com', { email: 'nadia@example.com', name: 'Nadia Rahman', role: 'SUPER_ADMIN', status: 'ACTIVE' }],
    ['tanzila@example.com', { email: 'tanzila@example.com', name: 'Tanzila Haque', role: 'USER', status: 'ACTIVE' }],
  ]);

  it('says whose account one email belongs to, or that nobody has it', () => {
    expect(failedSignInsDescription('198.51.100.77', 9, ['admin@example.com'], accounts)).toBe(
      '9 failed sign-ins from 198.51.100.77 within 15 minutes. They tried admin@example.com, which has no account here.',
    );
    expect(failedSignInsDescription('203.0.113.24', 5, ['nadia@example.com'], accounts)).toContain('nadia@example.com, an admin account.');
    expect(failedSignInsDescription('203.0.113.66', 6, ['tanzila@example.com'], accounts)).toContain("an app user's account.");
  });

  it('counts several accounts instead of listing them', () => {
    expect(failedSignInsDescription('203.0.113.140', 6, ['a@example.com', 'b@example.com'], accounts)).toBe(
      '6 failed sign-ins from 203.0.113.140 within 15 minutes. They tried 2 different accounts.',
    );
  });
});

describe('pausedNetworks', () => {
  it('keeps each network once, paused for 15 minutes from its refused try', () => {
    const paused = pausedNetworks(
      [
        { email: 'admin@example.com', ipAddress: '198.51.100.77', createdAt: at(8, 47) },
        { email: 'old@example.com', ipAddress: '198.51.100.77', createdAt: at(8, 40) },
      ],
      at(8, 50).getTime(),
    );
    expect(paused).toEqual([{ email: 'admin@example.com', ipAddress: '198.51.100.77', until: at(9, 2) }]);
  });

  it('drops a pause that has already run out', () => {
    expect(pausedNetworks([{ email: 'a@example.com', ipAddress: '203.0.113.9', createdAt: at(8, 0) }], at(8, 20).getTime())).toEqual([]);
  });
});

describe('signedInAfter', () => {
  const successes = [
    { email: 'nadia@example.com', createdAt: at(3, 0) },
    { email: 'nadia@example.com', createdAt: at(3, 2) },
    { email: 'shakil@example.com', createdAt: at(2, 2) },
  ];

  it('finds the first sign-in by the same email after the failed try', () => {
    expect(signedInAfter({ email: 'Nadia@Example.com', createdAt: at(3, 1) }, successes)).toEqual(at(3, 2));
  });

  it('ignores other emails, earlier sign-ins and anything a day later', () => {
    expect(signedInAfter({ email: 'tanzila@example.com', createdAt: at(1, 0) }, successes)).toBeNull();
    expect(signedInAfter({ email: 'nadia@example.com', createdAt: at(3, 5) }, successes)).toBeNull();
    expect(signedInAfter({ email: 'shakil@example.com', createdAt: new Date(at(2, 2).getTime() - 25 * 60 * 60 * 1000) }, successes)).toBeNull();
  });
});
