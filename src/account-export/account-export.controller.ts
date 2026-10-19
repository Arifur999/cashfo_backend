import { Controller, Get, Header, StreamableFile, UseGuards } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { CurrentUser } from '../user-auth/decorators/current-user.decorator.js';
import { UserAuthGuard } from '../user-auth/guards/user-auth.guard.js';
import type { RequestUser } from '../user-auth/interfaces/request-user.interface.js';
import { AccountExportService } from './account-export.service.js';

@UseGuards(UserAuthGuard)
@Controller('api/account')
export class AccountExportController {
  constructor(private readonly service: AccountExportService) {}

  // Reads every workspace the customer owns, so a few a minute at most.
  @Throttle({ default: { limit: 3, ttl: 60 * 1000 } })
  @Get('export')
  @Header('Cache-Control', 'private, no-store')
  async export(@CurrentUser() user: RequestUser) {
    const file = await this.service.export(user.id);
    return new StreamableFile(file.data, { type: 'application/zip', disposition: `attachment; filename="${file.fileName}"` });
  }
}
