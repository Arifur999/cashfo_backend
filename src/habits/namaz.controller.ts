import { Body, Controller, Delete, Get, Param, ParseUUIDPipe, Post, Put, UseGuards } from '@nestjs/common';
import { CurrentUser } from '../user-auth/decorators/current-user.decorator.js';
import { UserAuthGuard } from '../user-auth/guards/user-auth.guard.js';
import type { RequestUser } from '../user-auth/interfaces/request-user.interface.js';
import { LogQazaDto, SetQazaSinceDto } from './dto/qaza.dto.js';
import { NamazService } from './namaz.service.js';

// Namaz beyond the month sheets: the qaza still owed and the ones made up.
// User-scoped like the habit trackers.
@UseGuards(UserAuthGuard)
@Controller('api/namaz')
export class NamazController {
  constructor(private readonly namazService: NamazService) {}

  @Get('qaza')
  qaza(@CurrentUser() user: RequestUser) {
    return this.namazService.qaza(user.id);
  }

  @Put('qaza/since')
  setSince(@CurrentUser() user: RequestUser, @Body() dto: SetQazaSinceDto) {
    return this.namazService.setSince(user.id, dto);
  }

  @Post('qaza')
  log(@CurrentUser() user: RequestUser, @Body() dto: LogQazaDto) {
    return this.namazService.logQaza(user.id, dto);
  }

  @Delete('qaza/:id')
  remove(@CurrentUser() user: RequestUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.namazService.removeLog(user.id, id);
  }
}
