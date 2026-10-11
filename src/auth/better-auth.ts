import { dash } from '@better-auth/infra';
import { LanguagePreference, PrismaClient, Role, UserStatus } from '@prisma/client';
import { betterAuth } from 'better-auth';
import { prismaAdapter } from 'better-auth/adapters/prisma';
import { APIError } from 'better-auth/api';
import { hashPassword, verifyPassword } from './password.js';

// Where better-auth's own endpoints live -- also the path Google redirects
// back to: <BETTER_AUTH_URL>/api/auth/callback/google.
export const AUTH_BASE_PATH = '/api/auth';

export interface AuthOptions {
  prisma: PrismaClient;
  secret: string;
  // The public origin /api/auth is reached on (the site itself in production).
  baseURL: string;
  trustedOrigins: string[];
  google?: { clientId: string; clientSecret: string };
  // Better Auth Infra dashboard; the plugin stays off without a key.
  dashApiKey?: string;
}

export const createAuth = ({ prisma, secret, baseURL, trustedOrigins, google, dashApiKey }: AuthOptions) =>
  betterAuth({
    appName: 'Cashfo',
    secret,
    baseURL,
    basePath: AUTH_BASE_PATH,
    trustedOrigins,
    database: prismaAdapter(prisma, { provider: 'postgresql' }),
    advanced: { database: { generateId: 'uuid' } },
    user: {
      fields: { image: 'avatarUrl' },
      additionalFields: {
        // Never accepted from a client: roles are handed out by a super
        // admin, status by the admin panel.
        role: { type: Object.values(Role), required: false, defaultValue: Role.USER, input: false },
        status: { type: Object.values(UserStatus), required: false, defaultValue: UserStatus.ACTIVE, input: false },
        phone: { type: 'string', required: false },
        preferredLanguage: { type: Object.values(LanguagePreference), required: false, defaultValue: LanguagePreference.EN },
      },
    },
    // Auth* model names keep clear of the chart-of-accounts Account model.
    session: { modelName: 'authSession' },
    account: { modelName: 'authAccount' },
    verification: { modelName: 'verification' },
    emailAndPassword: {
      enabled: true,
      minPasswordLength: 8,
      // The app's bcrypt pair, so existing hashes keep working (see password.ts).
      password: { hash: hashPassword, verify: ({ hash, password }) => verifyPassword(password, hash) },
    },
    socialProviders: google ? { google } : undefined,
    databaseHooks: {
      session: {
        create: {
          // Every way in -- email, Google, the dashboard -- creates a session
          // here, so a suspended or deleted account is stopped at one place.
          before: async (session) => {
            const user = await prisma.user.findUnique({ where: { id: session.userId }, select: { status: true } });
            if (user?.status !== UserStatus.ACTIVE) {
              throw new APIError('FORBIDDEN', { message: 'This account is not active' });
            }
          },
        },
      },
    },
    plugins: dashApiKey ? [dash({ apiKey: dashApiKey })] : [],
  });

export type Auth = ReturnType<typeof createAuth>;

// Injection token for the app's one better-auth instance (see AuthModule).
export const BETTER_AUTH = Symbol('BETTER_AUTH');
