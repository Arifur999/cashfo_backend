import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { UserAuthModule } from '../user-auth/user-auth.module.js';
import { VaultAccessGuard } from './guards/vault-access.guard.js';
import { PasswordVaultController } from './password-vault.controller.js';
import { PasswordVaultService } from './password-vault.service.js';

@Module({
  // JwtModule.register({}) -- same reasoning as UserAuthModule: unlock()
  // signs and VaultAccessGuard verifies with their own explicit
  // secret/expiry (VAULT_TOKEN_SECRET), not a module default.
  // UserAuthModule: gives us UserAuthGuard for the controller's class-level
  // guard.
  imports: [JwtModule.register({}), UserAuthModule],
  controllers: [PasswordVaultController],
  providers: [PasswordVaultService, VaultAccessGuard],
})
export class PasswordVaultModule {}
