import { Body, Controller, Get, Put, UseGuards } from '@nestjs/common';
import { CurrentUser } from '../user-auth/decorators/current-user.decorator.js';
import { UserAuthGuard } from '../user-auth/guards/user-auth.guard.js';
import type { RequestUser } from '../user-auth/interfaces/request-user.interface.js';
import { UpdatePrivacyDto } from './dto/update-privacy.dto.js';
import { DataPrivacyService } from './data-privacy.service.js';

// Settings › Data & privacy.
@UseGuards(UserAuthGuard)
@Controller('api/data-privacy')
export class DataPrivacyController {
  constructor(private readonly dataPrivacy: DataPrivacyService) {}

  @Get()
  page(@CurrentUser() user: RequestUser) {
    return this.dataPrivacy.page(user.id);
  }

  @Put()
  update(@CurrentUser() user: RequestUser, @Body() dto: UpdatePrivacyDto) {
    return this.dataPrivacy.update(user.id, dto);
  }
}
