import { Module } from '@nestjs/common';
import { UserAuthModule } from '../user-auth/user-auth.module.js';
import { GroupAccessController } from './group-access.controller.js';
import { GroupAccessService } from './group-access.service.js';
import { GroupInvitesController } from './group-invites.controller.js';

// Group Expense's member portal: access links and the logins made with
// them. GroupExpensesModule uses the service to keep access in step with
// each member's role.
@Module({
  imports: [UserAuthModule],
  controllers: [GroupAccessController, GroupInvitesController],
  providers: [GroupAccessService],
  exports: [GroupAccessService],
})
export class GroupAccessModule {}
