import { Global, Module } from '@nestjs/common';
import { CredentialsService } from './credentials.service.js';

// Global, like PrismaModule: the auth core is needed by the admin and the
// end-user side alike, and by guards that run inside every feature module.
@Global()
@Module({
  providers: [CredentialsService],
  exports: [CredentialsService],
})
export class AuthModule {}
