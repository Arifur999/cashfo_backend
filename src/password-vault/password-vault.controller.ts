import { Body, Controller, Delete, Get, Param, Patch, Post, UseGuards } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { CurrentUser } from '../user-auth/decorators/current-user.decorator.js';
import { UserAuthGuard } from '../user-auth/guards/user-auth.guard.js';
import type { RequestUser } from '../user-auth/interfaces/request-user.interface.js';
import { CreateVaultEntryDto } from './dto/create-vault-entry.dto.js';
import { SetVaultPasswordDto } from './dto/set-vault-password.dto.js';
import { UnlockVaultDto } from './dto/unlock-vault.dto.js';
import { UpdateVaultEntryDto } from './dto/update-vault-entry.dto.js';
import { VaultAccessGuard } from './guards/vault-access.guard.js';
import { PasswordVaultService } from './password-vault.service.js';

// "Password Manager" menu -- a personal credential vault (Facebook/bank/etc.
// logins), unrelated to this app's own accounting data. Every route requires
// UserAuthGuard (real login); the entries routes additionally require
// VaultAccessGuard (a short-lived token from POST unlock) -- see that
// guard's comment for why the two are separate.
@UseGuards(UserAuthGuard)
@Controller('api/vault')
export class PasswordVaultController {
  constructor(private readonly passwordVaultService: PasswordVaultService) {}

  @Get('status')
  getStatus(@CurrentUser() user: RequestUser) {
    return this.passwordVaultService.getStatus(user.id);
  }

  @Post('password')
  setVaultPassword(@CurrentUser() user: RequestUser, @Body() dto: SetVaultPasswordDto) {
    return this.passwordVaultService.setVaultPassword(user.id, dto);
  }

  // Looser than the main login route's 5/15min -- login happens once a
  // session, but unlocking the vault is a normal, repeated action throughout
  // a single working session (open the page, step away, come back...), so
  // login's policy blocked honest re-unlocks in practice. Still a real
  // brute-force deterrent against a bcrypt-hashed password.
  @Throttle({ default: { limit: 10, ttl: 10 * 60 * 1000 } })
  @Post('unlock')
  unlock(@CurrentUser() user: RequestUser, @Body() dto: UnlockVaultDto) {
    return this.passwordVaultService.unlock(user.id, dto);
  }

  @UseGuards(VaultAccessGuard)
  @Get('entries')
  list(@CurrentUser() user: RequestUser) {
    return this.passwordVaultService.list(user.id);
  }

  @UseGuards(VaultAccessGuard)
  @Post('entries')
  create(@CurrentUser() user: RequestUser, @Body() dto: CreateVaultEntryDto) {
    return this.passwordVaultService.create(user.id, dto);
  }

  @UseGuards(VaultAccessGuard)
  @Patch('entries/:id')
  update(@CurrentUser() user: RequestUser, @Param('id') id: string, @Body() dto: UpdateVaultEntryDto) {
    return this.passwordVaultService.update(user.id, id, dto);
  }

  @UseGuards(VaultAccessGuard)
  @Delete('entries/:id')
  remove(@CurrentUser() user: RequestUser, @Param('id') id: string) {
    return this.passwordVaultService.remove(user.id, id);
  }

  @UseGuards(VaultAccessGuard)
  @Get('entries/:id/reveal')
  reveal(@CurrentUser() user: RequestUser, @Param('id') id: string) {
    return this.passwordVaultService.reveal(user.id, id);
  }
}
