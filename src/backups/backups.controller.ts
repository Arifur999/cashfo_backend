import { Body, Controller, Get, Headers, Param, ParseUUIDPipe, Post, Put, UseGuards } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { unlockTokens, WORKSPACE_UNLOCK_HEADER, WorkspaceUnlockService } from '../business-access/workspace-unlock.service.js';
import { CurrentUser } from '../user-auth/decorators/current-user.decorator.js';
import { UserAuthGuard } from '../user-auth/guards/user-auth.guard.js';
import type { RequestUser } from '../user-auth/interfaces/request-user.interface.js';
import { BackupsService } from './backups.service.js';
import { UpdateBackupSettingsDto } from './dto/update-backup-settings.dto.js';

// Settings › Data & privacy › Backup and restore. A View as customer
// session reads only (UserAuthGuard refuses its writes).
@UseGuards(UserAuthGuard)
@Controller('api/backups')
export class BackupsController {
  constructor(
    private readonly backups: BackupsService,
    private readonly unlocks: WorkspaceUnlockService,
  ) {}

  @Get()
  page(@CurrentUser() user: RequestUser) {
    return this.backups.page(user.id);
  }

  @Put('settings')
  updateSettings(@CurrentUser() user: RequestUser, @Body() dto: UpdateBackupSettingsDto) {
    return this.backups.updateSettings(user.id, dto);
  }

  // Copies every workspace the person owns, so a few a minute at most.
  @Throttle({ default: { limit: 3, ttl: 60 * 1000 } })
  @Post()
  backUpNow(@CurrentUser() user: RequestUser) {
    return this.backups.backUpNow(user.id);
  }

  // A workspace locked with a PIN is restored only with its unlock (the
  // header may carry several, comma-separated), like the data download.
  @Throttle({ default: { limit: 3, ttl: 60 * 1000 } })
  @Post(':id/restore')
  restore(@CurrentUser() user: RequestUser, @Param('id', ParseUUIDPipe) id: string, @Headers(WORKSPACE_UNLOCK_HEADER) unlock: string | undefined) {
    const tokens = unlockTokens(unlock);
    return this.backups.restore(user.id, id, (workspace) => this.unlocks.isShut(user, workspace, tokens));
  }
}
