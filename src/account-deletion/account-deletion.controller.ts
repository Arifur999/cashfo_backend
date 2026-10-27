import { Body, Controller, Get, HttpCode, Post, UseGuards } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { CurrentUser } from '../user-auth/decorators/current-user.decorator.js';
import { UserAuthGuard } from '../user-auth/guards/user-auth.guard.js';
import type { RequestUser } from '../user-auth/interfaces/request-user.interface.js';
import { AccountDeletionService } from './account-deletion.service.js';
import { DeleteAccountDto } from './dto/delete-account.dto.js';

// Settings > Resources > Delete my account.
@UseGuards(UserAuthGuard)
@Controller('api/account/delete')
export class AccountDeletionController {
  constructor(private readonly deletion: AccountDeletionService) {}

  // What the dialog lists as going away.
  @Get('preview')
  preview(@CurrentUser() user: RequestUser) {
    return this.deletion.preview(user.id);
  }

  // Checks the password, so it gets a brute-force budget like
  // change-password's.
  @Throttle({ default: { limit: 5, ttl: 15 * 60 * 1000 } })
  @Post()
  @HttpCode(200)
  request(@CurrentUser() user: RequestUser, @Body() dto: DeleteAccountDto) {
    return this.deletion.request(user.id, user.sessionId, user.impersonatedBy, dto);
  }
}
