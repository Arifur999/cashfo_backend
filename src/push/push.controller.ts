import { Body, Controller, Delete, Get, Headers, HttpCode, Post, UseGuards } from '@nestjs/common';
import { CurrentUser } from '../user-auth/decorators/current-user.decorator.js';
import { UserAuthGuard } from '../user-auth/guards/user-auth.guard.js';
import type { RequestUser } from '../user-auth/interfaces/request-user.interface.js';
import { SubscribePushDto, UnsubscribePushDto } from './dto/push-subscription.dto.js';
import { PushService } from './push.service.js';

// Settings > App > Reminders: "Notifications on this device".
@UseGuards(UserAuthGuard)
@Controller('api/push')
export class PushController {
  constructor(private readonly pushService: PushService) {}

  @Get('key')
  key() {
    return this.pushService.publicKey();
  }

  @Post('subscriptions')
  @HttpCode(200)
  subscribe(@CurrentUser() user: RequestUser, @Body() dto: SubscribePushDto, @Headers('user-agent') userAgent?: string) {
    return this.pushService.subscribe(user.id, dto, userAgent);
  }

  @Delete('subscriptions')
  unsubscribe(@CurrentUser() user: RequestUser, @Body() dto: UnsubscribePushDto) {
    return this.pushService.unsubscribe(user.id, dto.endpoint);
  }

  @Post('test')
  @HttpCode(200)
  test(@CurrentUser() user: RequestUser) {
    return this.pushService.sendTest(user.id);
  }
}
