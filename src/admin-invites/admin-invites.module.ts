import { Module, type OnModuleInit } from '@nestjs/common';
import { AdminAuthModule } from '../admin-auth/admin-auth.module.js';
import { HousekeepingScheduler } from '../housekeeping/housekeeping.scheduler.js';
import { MailModule } from '../mail/mail.module.js';
import { AdminAccountAccessController, AdminInvitesController } from './admin-invites.controller.js';
import { AdminInvitesService } from './admin-invites.service.js';
import { AdminPasswordResetService } from './admin-password-reset.service.js';

const HOUR = 60 * 60 * 1000;

// Admin invites by email link (7 days) and the admin's own emailed password
// reset (30 minutes). TwoStepService comes from the global TwoStepModule.
@Module({
  imports: [AdminAuthModule, MailModule],
  controllers: [AdminInvitesController, AdminAccountAccessController],
  providers: [AdminInvitesService, AdminPasswordResetService],
})
export class AdminInvitesModule implements OnModuleInit {
  constructor(
    private readonly housekeeping: HousekeepingScheduler,
    private readonly invites: AdminInvitesService,
  ) {}

  onModuleInit() {
    this.housekeeping.register({ name: 'admin-invite-cleanup', everyMs: HOUR, run: (now) => this.invites.cleanup(now) });
  }
}
