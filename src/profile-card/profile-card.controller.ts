import { Body, Controller, Get, Param, Put, UseGuards } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { IsBoolean } from 'class-validator';
import { CurrentUser } from '../user-auth/decorators/current-user.decorator.js';
import { UserAuthGuard } from '../user-auth/guards/user-auth.guard.js';
import type { RequestUser } from '../user-auth/interfaces/request-user.interface.js';
import { ProfileCardService } from './profile-card.service.js';

export class ShareProfileCardDto {
  @IsBoolean()
  shared: boolean;
}

// Settings > Profile: turning the shareable card on or off.
@UseGuards(UserAuthGuard)
@Controller('api/profile-card')
export class ProfileCardController {
  constructor(private readonly service: ProfileCardService) {}

  @Put()
  setShared(@CurrentUser() user: RequestUser, @Body() dto: ShareProfileCardDto) {
    return this.service.setShared(user.id, dto.shared);
  }
}

// No sign-in: the card page (/card/<code>) and the picture social apps show
// for its link.
@Controller('api/profile-card/public')
export class PublicProfileCardController {
  constructor(private readonly service: ProfileCardService) {}

  @Throttle({ default: { limit: 60, ttl: 60 * 1000 } })
  @Get(':code')
  card(@Param('code') code: string) {
    return this.service.card(code);
  }
}
