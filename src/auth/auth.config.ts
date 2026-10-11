import type { ConfigService } from '@nestjs/config';
import type { AuthOptions } from './better-auth.js';

// better-auth's settings, read from the environment (see .env.example).
// Google sign-in and the Infra dashboard switch on only when configured.
export const authOptionsFromEnv = (config: ConfigService): Omit<AuthOptions, 'prisma'> => {
  const baseURL = config.getOrThrow<string>('BETTER_AUTH_URL');
  const clientId = config.get<string>('GOOGLE_CLIENT_ID');
  const clientSecret = config.get<string>('GOOGLE_CLIENT_SECRET');
  const origins = [baseURL, config.get<string>('ADMIN_FRONTEND_URL'), config.get<string>('USER_FRONTEND_URL')];

  return {
    secret: config.getOrThrow<string>('BETTER_AUTH_SECRET'),
    baseURL,
    trustedOrigins: [...new Set(origins.filter((origin): origin is string => Boolean(origin)))],
    google: clientId && clientSecret ? { clientId, clientSecret } : undefined,
    dashApiKey: config.get<string>('BETTER_AUTH_API_KEY') || undefined,
  };
};
