import { Global, Module, type OnModuleInit } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { AdminAuthModule } from '../admin-auth/admin-auth.module.js';
import { HousekeepingScheduler } from '../housekeeping/housekeeping.scheduler.js';
import { MailModule } from '../mail/mail.module.js';
import { SettingsModule } from '../settings/settings.module.js';
import { UserAuthModule } from '../user-auth/user-auth.module.js';
import { AdminOrSetupTokenGuard } from './admin-or-setup-token.guard.js';
import { AdminTwoStepController } from './admin-two-step.controller.js';
import { AdminTwoStepService } from './admin-two-step.service.js';
import { TwoStepService } from './two-step.service.js';
import { UserTwoStepController } from './user-two-step.controller.js';

const HOUR = 60 * 60 * 1000;

// Two-step sign-in. Global, like BusinessAccessModule: both sign-in
// services (AdminAuthModule, UserAuthModule) call TwoStepService.gate(),
// and this module's controllers use their guards -- importing each other
// would be circular. JwtModule signs the short-lived challenge tokens.
@Global()
@Module({
  imports: [JwtModule.register({}), MailModule, SettingsModule, UserAuthModule, AdminAuthModule],
  controllers: [UserTwoStepController, AdminTwoStepController],
  providers: [TwoStepService, AdminTwoStepService, AdminOrSetupTokenGuard],
  exports: [TwoStepService],
})
export class TwoStepModule implements OnModuleInit {
  constructor(
    private readonly housekeeping: HousekeepingScheduler,
    private readonly twoStep: TwoStepService,
  ) {}

  onModuleInit() {
    this.housekeeping.register({ name: 'two-step-cleanup', everyMs: HOUR, run: (now) => this.twoStep.cleanup(now) });
  }
}
