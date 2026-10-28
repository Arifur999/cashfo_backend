import { BadRequestException, Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Post, Req, UseGuards } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import type { Request } from 'express';
import { CurrentUser } from '../user-auth/decorators/current-user.decorator.js';
import { UserAuthGuard } from '../user-auth/guards/user-auth.guard.js';
import type { RequestUser } from '../user-auth/interfaces/request-user.interface.js';
import { DisableTwoStepDto, EnableTwoStepDto, RegenerateBackupCodesDto, StartTwoStepSetupDto } from './dto/two-step.dto.js';
import { TwoStepService } from './two-step.service.js';

// Each of these checks a password or a code.
const CHANGE_THROTTLE = { default: { limit: 10, ttl: 15 * 60 * 1000 } };

// Settings > Security > Two-step sign-in, for customers. A super admin's
// read-only "View as customer" session can read the status but change
// nothing (UserAuthGuard refuses anything but GET).
@UseGuards(UserAuthGuard)
@Controller('api/auth/two-step')
export class UserTwoStepController {
  constructor(private readonly twoStep: TwoStepService) {}

  // trustedDevices[].current is true for this computer when the frontend
  // forwards its trustedDevice_<id> cookie in x-trusted-device.
  @Get()
  status(@CurrentUser() user: RequestUser, @Req() req: Request) {
    return this.twoStep.status(user.id, 'user', req.headers['x-trusted-device']);
  }

  @Throttle(CHANGE_THROTTLE)
  @Post('setup')
  setup(@CurrentUser() user: RequestUser, @Body() dto: StartTwoStepSetupDto) {
    return this.twoStep.startSetup(user, 'user', { password: dto.password, sessionId: user.sessionId });
  }

  @Throttle(CHANGE_THROTTLE)
  @Post('enable')
  async enable(@CurrentUser() user: RequestUser, @Body() dto: EnableTwoStepDto) {
    const result = await this.twoStep.enable(user.id, dto.code);
    await this.twoStep.notifyCustomer(user.id, 'ON');
    return result;
  }

  @Throttle(CHANGE_THROTTLE)
  @Post('backup-codes')
  backupCodes(@CurrentUser() user: RequestUser, @Body() dto: RegenerateBackupCodesDto) {
    return this.twoStep.regenerateBackupCodes(user.id, { password: dto.password, sessionId: user.sessionId }, dto.code);
  }

  @Throttle(CHANGE_THROTTLE)
  @Post('disable')
  async disable(@CurrentUser() user: RequestUser, @Body() dto: DisableTwoStepDto) {
    if (Boolean(dto.code) === Boolean(dto.backupCode)) throw new BadRequestException('Send either a code from your authenticator app or a backup code');
    await this.twoStep.disable(user.id, 'user', { password: dto.password, sessionId: user.sessionId }, { code: dto.code, backupCode: dto.backupCode });
    await this.twoStep.notifyCustomer(user.id, 'OFF');
    return { success: true };
  }

  @HttpCode(200)
  @Delete('trusted-devices/:id')
  async removeTrustedDevice(@CurrentUser() user: RequestUser, @Param('id', ParseUUIDPipe) id: string) {
    await this.twoStep.removeTrustedDevice(user.id, id);
    return { success: true };
  }

  @HttpCode(200)
  @Delete('trusted-devices')
  async removeTrustedDevices(@CurrentUser() user: RequestUser) {
    return { removed: await this.twoStep.removeTrustedDevices(user.id) };
  }
}
