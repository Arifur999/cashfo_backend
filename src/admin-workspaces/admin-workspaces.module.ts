import { Module } from '@nestjs/common';
import { AdminWorkspacesController } from './admin-workspaces.controller.js';
import { AdminWorkspacesService } from './admin-workspaces.service.js';

@Module({
  controllers: [AdminWorkspacesController],
  providers: [AdminWorkspacesService],
})
export class AdminWorkspacesModule {}
