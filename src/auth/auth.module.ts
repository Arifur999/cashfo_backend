import { Global, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import { PrismaService } from '../prisma/prisma.service.js';
import { AuthSessionsService } from './auth-sessions.service.js';
import { authOptionsFromEnv } from './auth.config.js';
import { BETTER_AUTH, createAuth } from './better-auth.js';
import { CredentialsService } from './credentials.service.js';
import { SessionAuthenticator } from './session-authenticator.service.js';
import { SessionTokensService } from './session-tokens.service.js';

// Global, like PrismaModule: the auth core is needed by the admin and the
// end-user side alike, and by guards that run inside every feature module.
@Global()
@Module({
  // No default secret: SessionTokensService passes each audience's own.
  imports: [JwtModule.register({})],
  providers: [
    CredentialsService,
    SessionTokensService,
    AuthSessionsService,
    SessionAuthenticator,
    {
      provide: BETTER_AUTH,
      inject: [PrismaService, ConfigService],
      useFactory: (prisma: PrismaService, config: ConfigService) => createAuth({ prisma, ...authOptionsFromEnv(config) }),
    },
  ],
  exports: [CredentialsService, SessionTokensService, AuthSessionsService, SessionAuthenticator, BETTER_AUTH],
})
export class AuthModule {}
