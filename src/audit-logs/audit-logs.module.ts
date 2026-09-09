import { Module } from '@nestjs/common';
import { AdminAuthModule } from '../admin-auth/admin-auth.module.js';
import { AuditLogsController } from './audit-logs.controller.js';
import { AuditLogsService } from './audit-logs.service.js';

@Module({
  imports: [AdminAuthModule],
  controllers: [AuditLogsController],
  providers: [AuditLogsService],
})
export class AuditLogsModule {}
