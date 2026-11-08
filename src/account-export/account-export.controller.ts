import { Controller, Get, Header, Headers, Query, StreamableFile, UseGuards } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { unlockTokens, WORKSPACE_UNLOCK_HEADER, WorkspaceUnlockService } from '../business-access/workspace-unlock.service.js';
import { CurrentUser } from '../user-auth/decorators/current-user.decorator.js';
import { UserAuthGuard } from '../user-auth/guards/user-auth.guard.js';
import type { RequestUser } from '../user-auth/interfaces/request-user.interface.js';
import { AccountExportService } from './account-export.service.js';
import { ExportQueryDto } from './dto/export-query.dto.js';

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
  async export(@CurrentUser() user: RequestUser, @Headers(WORKSPACE_UNLOCK_HEADER) unlock: string | undefined, @Query() query: ExportQueryDto) {
    const tokens = unlockTokens(unlock);
    const { format, ...choice } = query;
    const file = await this.service.export(user.id, (workspace) => this.unlocks.isShut(user, workspace, tokens), choice, format);
    return new StreamableFile(file.data, { type: file.type, disposition: `attachment; filename="${file.fileName}"` });
  }

  // The same records as tables, for the page that prints them as a PDF.
  @Throttle({ default: { limit: 5, ttl: 60 * 1000 } })
  @Get('export/printable')
  @Header('Cache-Control', 'private, no-store')
  printable(@CurrentUser() user: RequestUser, @Headers(WORKSPACE_UNLOCK_HEADER) unlock: string | undefined, @Query() query: ExportQueryDto) {
    const tokens = unlockTokens(unlock);
    const { format: _format, ...choice } = query;
    return this.service.printable(user.id, (workspace) => this.unlocks.isShut(user, workspace, tokens), choice);
  }
}
