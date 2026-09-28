import { Module } from '@nestjs/common';
import { UserAuthModule } from '../user-auth/user-auth.module.js';
import { TodosController } from './todos.controller.js';
import { TodosService } from './todos.service.js';

@Module({
  imports: [UserAuthModule],
  controllers: [TodosController],
  providers: [TodosService],
})
export class TodosModule {}
