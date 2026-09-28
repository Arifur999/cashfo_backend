import { Body, Controller, Delete, Get, Param, ParseUUIDPipe, Patch, Post, UseGuards } from '@nestjs/common';
import { CurrentUser } from '../user-auth/decorators/current-user.decorator.js';
import { UserAuthGuard } from '../user-auth/guards/user-auth.guard.js';
import type { RequestUser } from '../user-auth/interfaces/request-user.interface.js';
import { CreateTodoItemDto } from './dto/create-todo-item.dto.js';
import { CreateTodoListDto } from './dto/create-todo-list.dto.js';
import { UpdateTodoItemDto } from './dto/update-todo-item.dto.js';
import { TodosService } from './todos.service.js';

// Habit Tracker -> To Do List. User-scoped like HabitsController (no
// :businessId).
@UseGuards(UserAuthGuard)
@Controller('api/todos')
export class TodosController {
  constructor(private readonly todosService: TodosService) {}

  @Get()
  list(@CurrentUser() user: RequestUser) {
    return this.todosService.list(user.id);
  }

  @Post()
  create(@CurrentUser() user: RequestUser, @Body() dto: CreateTodoListDto) {
    return this.todosService.create(user.id, dto);
  }

  @Get(':id')
  get(@CurrentUser() user: RequestUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.todosService.get(user.id, id);
  }

  @Delete(':id')
  remove(@CurrentUser() user: RequestUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.todosService.remove(user.id, id);
  }

  @Post(':id/items')
  addItem(@CurrentUser() user: RequestUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: CreateTodoItemDto) {
    return this.todosService.addItem(user.id, id, dto);
  }

  @Patch(':id/items/:itemId')
  updateItem(
    @CurrentUser() user: RequestUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('itemId', ParseUUIDPipe) itemId: string,
    @Body() dto: UpdateTodoItemDto,
  ) {
    return this.todosService.updateItem(user.id, id, itemId, dto);
  }

  @Delete(':id/items/:itemId')
  removeItem(@CurrentUser() user: RequestUser, @Param('id', ParseUUIDPipe) id: string, @Param('itemId', ParseUUIDPipe) itemId: string) {
    return this.todosService.removeItem(user.id, id, itemId);
  }

  @Post(':id/items/:itemId/move-to-next-day')
  moveItemToNextDay(@CurrentUser() user: RequestUser, @Param('id', ParseUUIDPipe) id: string, @Param('itemId', ParseUUIDPipe) itemId: string) {
    return this.todosService.moveItemToNextDay(user.id, id, itemId);
  }
}
