import { Global, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service.js';
import { authOptionsFromEnv } from './auth.config.js';
import { BETTER_AUTH, createAuth } from './better-auth.js';
import { CredentialsService } from './credentials.service.js';

// Global, like PrismaModule: the auth core is needed by the admin and the
// end-user side alike, and by guards that run inside every feature module.
@Global()
@Module({
  providers: [
    CredentialsService,
    {
      provide: BETTER_AUTH,
      inject: [PrismaService, ConfigService],
      useFactory: (prisma: PrismaService, config: ConfigService) => createAuth({ prisma, ...authOptionsFromEnv(config) }),
    },
  ],
  exports: [CredentialsService, BETTER_AUTH],
})
export class AuthModule {}
