import type { ConfigService } from '@nestjs/config';
import { authOptionsFromEnv } from './auth.config.js';

const configFrom = (env: Record<string, string>) =>
  ({
    get: (key: string) => env[key],
    getOrThrow: (key: string) => {
      if (!(key in env)) throw new Error(`missing ${key}`);
      return env[key];
    },
  }) as unknown as ConfigService;

const base = { BETTER_AUTH_URL: 'https://smartly.softech.agency', BETTER_AUTH_SECRET: 's3cret' };

describe('authOptionsFromEnv', () => {
  it('requires the secret and the public URL', () => {
    expect(() => authOptionsFromEnv(configFrom({ BETTER_AUTH_URL: base.BETTER_AUTH_URL }))).toThrow('BETTER_AUTH_SECRET');
    expect(() => authOptionsFromEnv(configFrom({ BETTER_AUTH_SECRET: 's3cret' }))).toThrow('BETTER_AUTH_URL');
  });

  it('trusts the public URL and both frontends, once each', () => {
    const options = authOptionsFromEnv(
      configFrom({ ...base, ADMIN_FRONTEND_URL: 'http://localhost:3000', USER_FRONTEND_URL: 'https://smartly.softech.agency' }),
    );
    expect(options.trustedOrigins).toEqual(['https://smartly.softech.agency', 'http://localhost:3000']);
  });

  it('turns Google on only with both credentials', () => {
    expect(authOptionsFromEnv(configFrom({ ...base, GOOGLE_CLIENT_ID: 'id' })).google).toBeUndefined();
    expect(authOptionsFromEnv(configFrom({ ...base, GOOGLE_CLIENT_ID: 'id', GOOGLE_CLIENT_SECRET: 'secret' })).google).toEqual({
      clientId: 'id',
      clientSecret: 'secret',
    });
  });

  it('leaves the dashboard off without an API key', () => {
    expect(authOptionsFromEnv(configFrom(base)).dashApiKey).toBeUndefined();
    expect(authOptionsFromEnv(configFrom({ ...base, BETTER_AUTH_API_KEY: 'key' })).dashApiKey).toBe('key');
  });
});
