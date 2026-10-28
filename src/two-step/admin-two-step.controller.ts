import { BadRequestException, Body, Controller, Delete, Get, Param, ParseUUIDPipe, Post, Req, UseGuards } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import type { Request } from 'express';
import { CurrentAdmin } from '../admin-auth/decorators/current-admin.decorator.js';
import { AdminAuthGuard } from '../admin-auth/guards/admin-auth.guard.js';
import type { RequestAdminUser } from '../admin-auth/interfaces/request-admin-user.interface.js';
import { TWO_STEP_THROTTLE } from '../common/login-throttle.js';
import { AdminStartTwoStepSetupDto, AdminEnableTwoStepDto, DisableTwoStepDto, RegenerateBackupCodesDto } from './dto/two-step.dto.js';
import { AdminTwoStepService } from './admin-two-step.service.js';
import { AdminOrSetupTokenGuard, type SetupRequest } from './admin-or-setup-token.guard.js';

const CHANGE_THROTTLE = { default: { limit: 10, ttl: 15 * 60 * 1000 } };

// My account > Two-step verification, for every admin. setup and enable
// also take the setupToken a sign-in answers with when two-step is required
// for every admin and this one has none yet; enable then signs them in.
@Controller('admin/auth/two-step')
export class AdminTwoStepController {
  constructor(private readonly adminTwoStep: AdminTwoStepService) {}

  @UseGuards(AdminAuthGuard)
  @Get()
  status(@CurrentAdmin() admin: RequestAdminUser, @Req() req: Request) {
    return this.adminTwoStep.status(admin.id, req.headers['x-trusted-device']);
  }

  @Throttle(TWO_STEP_THROTTLE)
  @UseGuards(AdminOrSetupTokenGuard)
  @Post('setup')
  setup(@Req() req: SetupRequest, @Body() dto: AdminStartTwoStepSetupDto) {
    return this.adminTwoStep.setup(req, dto.password);
  }

  @Throttle(TWO_STEP_THROTTLE)
  @UseGuards(AdminOrSetupTokenGuard)
  @Post('enable')
  enable(@Req() req: SetupRequest, @Body() dto: AdminEnableTwoStepDto) {
    return this.adminTwoStep.enable(req, dto);
  }

  @Throttle(CHANGE_THROTTLE)
  @UseGuards(AdminAuthGuard)
  @Post('backup-codes')
  backupCodes(@CurrentAdmin() admin: RequestAdminUser, @Body() dto: RegenerateBackupCodesDto, @Req() req: Request) {
    return this.adminTwoStep.regenerateBackupCodes(admin, dto, req.ip);
  }

  @Throttle(CHANGE_THROTTLE)
  @UseGuards(AdminAuthGuard)
  @Post('disable')
  disable(@CurrentAdmin() admin: RequestAdminUser, @Body() dto: DisableTwoStepDto, @Req() req: Request) {
    if (Boolean(dto.code) === Boolean(dto.backupCode)) throw new BadRequestException('Send either a code from your authenticator app or a backup code');
    return this.adminTwoStep.disable(admin, dto, req.ip);
  }

  @UseGuards(AdminAuthGuard)
  @Delete('trusted-devices/:id')
  removeTrustedDevice(@CurrentAdmin() admin: RequestAdminUser, @Param('id', ParseUUIDPipe) id: string, @Req() req: Request) {
    return this.adminTwoStep.removeTrustedDevice(admin.id, id, req.ip);
  }

  @UseGuards(AdminAuthGuard)
  @Delete('trusted-devices')
  removeTrustedDevices(@CurrentAdmin() admin: RequestAdminUser, @Req() req: Request) {
    return this.adminTwoStep.removeTrustedDevices(admin.id, req.ip);
  }
}
