import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, UseGuards } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { CurrentUser } from '../user-auth/decorators/current-user.decorator.js';
import { UserAuthGuard } from '../user-auth/guards/user-auth.guard.js';
import type { RequestUser } from '../user-auth/interfaces/request-user.interface.js';
import { CreateVaultEntryDto } from './dto/create-vault-entry.dto.js';
import { ResetVaultDto, StartVaultResetDto } from './dto/reset-vault.dto.js';
import { SetVaultPasswordDto } from './dto/set-vault-password.dto.js';
import { UnlockVaultDto, VerifyVaultUnlockDto } from './dto/unlock-vault.dto.js';
import { UpdateVaultEntryDto } from './dto/update-vault-entry.dto.js';
import { UpdateVaultSettingsDto } from './dto/vault-settings.dto.js';
import { VaultAccessGuard } from './guards/vault-access.guard.js';
import { PasswordVaultService } from './password-vault.service.js';

// "Password Manager" menu -- a personal credential vault (Facebook/bank/etc.
// logins), unrelated to this app's own accounting data. Every route requires
// UserAuthGuard (real login); the entries routes additionally require
// VaultAccessGuard (a short-lived token from POST unlock) -- see that
// guard's comment for why the two are separate.
// A code costs an email: a few starts and resends per quarter hour.
const CODE_THROTTLE = { default: { limit: 10, ttl: 15 * 60 * 1000 } };

@UseGuards(UserAuthGuard)
@Controller('api/vault')
export class PasswordVaultController {
  constructor(private readonly passwordVaultService: PasswordVaultService) {}

  @Get('status')
  getStatus(@CurrentUser() user: RequestUser) {
    return this.passwordVaultService.getStatus(user.id);
  }

  // How long an unlock lasts (1-30 minutes, or null for the server's).
  // Needs only the login: a longer lock time opens nothing by itself.
  @Patch('settings')
  updateSettings(@CurrentUser() user: RequestUser, @Body() dto: UpdateVaultSettingsDto) {
    return this.passwordVaultService.updateSettings(user.id, dto);
  }

  // Both check the account password, so they share the login route's
  // brute-force budget rather than the global 100/min.
  @Throttle({ default: { limit: 5, ttl: 15 * 60 * 1000 } })
  @Post('password')
  setVaultPassword(@CurrentUser() user: RequestUser, @Body() dto: SetVaultPasswordDto) {
    return this.passwordVaultService.setVaultPassword(user.id, dto);
  }

  // "Forgot vault password?": the account password, then a code by email
  // (the same budget as a withdrawal's codes), then the reset itself.
  @Throttle(CODE_THROTTLE)
  @Post('reset/start')
  @HttpCode(200)
  startReset(@CurrentUser() user: RequestUser, @Body() dto: StartVaultResetDto) {
    return this.passwordVaultService.startReset(user, dto);
  }

  @Throttle(CODE_THROTTLE)
  @Post('reset/start/:challengeId/resend')
  @HttpCode(200)
  resendResetCode(@CurrentUser() user: RequestUser, @Param('challengeId') challengeId: string) {
    return this.passwordVaultService.resendResetCode(user, challengeId);
  }

  @Throttle({ default: { limit: 5, ttl: 15 * 60 * 1000 } })
  @Post('reset')
  resetVault(@CurrentUser() user: RequestUser, @Body() dto: ResetVaultDto) {
    return this.passwordVaultService.resetVault(user, dto);
  }

  // The real limit is counted per person in the service (ten wrong tries in
  // ten minutes, with the tries left in each 401). This is only a backstop
  // per caller, set above it so an honest person sees the service's
  // message, not a bare 429 -- unlocking is a normal, repeated action
  // through a working session (open the page, step away, come back...).
  // Step one of two: the right vault password emails a code (and answers
  // the challenge, not a vault token).
  @Throttle({ default: { limit: 20, ttl: 10 * 60 * 1000 } })
  @Post('unlock')
  unlock(@CurrentUser() user: RequestUser, @Body() dto: UnlockVaultDto) {
    return this.passwordVaultService.unlock(user, dto);
  }

  @Throttle(CODE_THROTTLE)
  @Post('unlock/:challengeId/resend')
  @HttpCode(200)
  resendUnlockCode(@CurrentUser() user: RequestUser, @Param('challengeId') challengeId: string) {
    return this.passwordVaultService.resendUnlockCode(user, challengeId);
  }

  // Step two: the code opens the vault. Each code takes five tries; this
  // only stops a caller asking for new ones over and over.
  @Throttle({ default: { limit: 20, ttl: 10 * 60 * 1000 } })
  @Post('unlock/verify')
  @HttpCode(200)
  verifyUnlock(@CurrentUser() user: RequestUser, @Body() dto: VerifyVaultUnlockDto) {
    return this.passwordVaultService.verifyUnlock(user, dto);
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
  @Get('checkup')
  checkup(@CurrentUser() user: RequestUser) {
    return this.passwordVaultService.checkup(user.id);
  }

  @UseGuards(VaultAccessGuard)
  @Post('entries/:id/checkup-dismiss')
  dismissCheckup(@CurrentUser() user: RequestUser, @Param('id') id: string) {
    return this.passwordVaultService.dismissCheckup(user.id, id);
  }

  @UseGuards(VaultAccessGuard)
  @Get('entries/:id/reveal')
  reveal(@CurrentUser() user: RequestUser, @Param('id') id: string) {
    return this.passwordVaultService.reveal(user.id, id);
  }
}
