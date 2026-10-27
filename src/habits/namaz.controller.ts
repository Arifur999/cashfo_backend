import { Body, Controller, Delete, Get, Param, ParseUUIDPipe, Post, Put, Query, UseGuards } from '@nestjs/common';
import { CurrentUser } from '../user-auth/decorators/current-user.decorator.js';
import { UserAuthGuard } from '../user-auth/guards/user-auth.guard.js';
import type { RequestUser } from '../user-auth/interfaces/request-user.interface.js';
import { NamazTodayQueryDto } from './dto/namaz-today.dto.js';
import { LogQazaDto, SetQazaSinceDto, UpdatePrayerSettingsDto } from './dto/qaza.dto.js';
import { NamazService } from './namaz.service.js';

// Namaz beyond the month sheets: the settings prayer times are worked out
// from, the qaza still owed and the ones made up. User-scoped like the habit
// trackers.
@UseGuards(UserAuthGuard)
@Controller('api/namaz')
export class NamazController {
  constructor(private readonly namazService: NamazService) {}

  @Get('settings')
  settings(@CurrentUser() user: RequestUser) {
    return this.namazService.settings(user.id);
  }

  // The day's prayer times from the person's settings, so the app no
  // longer has to work them out itself.
  @Get('today')
  today(@CurrentUser() user: RequestUser, @Query() query: NamazTodayQueryDto) {
    return this.namazService.today(user.id, query.date);
  }

  @Put('settings')
  updateSettings(@CurrentUser() user: RequestUser, @Body() dto: UpdatePrayerSettingsDto) {
    return this.namazService.updateSettings(user.id, dto);
  }

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
