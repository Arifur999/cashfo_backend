import { Controller, Get, Header, Headers, StreamableFile, UseGuards } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { unlockTokens, WORKSPACE_UNLOCK_HEADER, WorkspaceUnlockService } from '../business-access/workspace-unlock.service.js';
import { CurrentUser } from '../user-auth/decorators/current-user.decorator.js';
import { UserAuthGuard } from '../user-auth/guards/user-auth.guard.js';
import type { RequestUser } from '../user-auth/interfaces/request-user.interface.js';
import { AccountExportService } from './account-export.service.js';

@UseGuards(UserAuthGuard)
@Controller('api/account')
export class AccountExportController {
  constructor(
    private readonly service: AccountExportService,
    private readonly unlocks: WorkspaceUnlockService,
  ) {}

  // Reads every workspace the customer owns, so a few a minute at most. A
  // PIN-locked one comes in only with its unlock (the header may carry
  // several, comma-separated): the PIN keeps its books shut from anyone
  // holding the signed-in device.
  @Throttle({ default: { limit: 3, ttl: 60 * 1000 } })
  @Get('export')
  @Header('Cache-Control', 'private, no-store')
  async export(@CurrentUser() user: RequestUser, @Headers(WORKSPACE_UNLOCK_HEADER) unlock: string | undefined) {
    const tokens = unlockTokens(unlock);
    const file = await this.service.export(user.id, (workspace) => this.unlocks.isShut(user, workspace, tokens));
    return new StreamableFile(file.data, { type: 'application/zip', disposition: `attachment; filename="${file.fileName}"` });
  }
}
