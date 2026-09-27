import { Body, Controller, Delete, Get, Param, ParseUUIDPipe, Patch, Post, Put, UseGuards } from '@nestjs/common';
import { CurrentUser } from '../user-auth/decorators/current-user.decorator.js';
import { UserAuthGuard } from '../user-auth/guards/user-auth.guard.js';
import type { RequestUser } from '../user-auth/interfaces/request-user.interface.js';
import { CreateSkillDto } from './dto/create-skill.dto.js';
import { SetSkillGoalDto } from './dto/set-skill-goal.dto.js';
import { UpdateSkillDto } from './dto/update-skill.dto.js';
import { SkillsService } from './skills.service.js';

// Habit Tracker -> Skills. User-scoped like BooksController (no :businessId).
@UseGuards(UserAuthGuard)
@Controller('api/skills')
export class SkillsController {
  constructor(private readonly skillsService: SkillsService) {}

  // The whole first page in one call: the year, its goal, the streak, the last
  // seven days of activity and every skill.
  @Get()
  overview(@CurrentUser() user: RequestUser) {
    return this.skillsService.overview(user.id);
  }

  @Post()
  create(@CurrentUser() user: RequestUser, @Body() dto: CreateSkillDto) {
    return this.skillsService.create(user.id, dto);
  }

  // Static segments, declared before the :id routes below.
  @Put('goal')
  setGoal(@CurrentUser() user: RequestUser, @Body() dto: SetSkillGoalDto) {
    return this.skillsService.setGoal(user.id, dto);
  }

  @Delete('goal')
  clearGoal(@CurrentUser() user: RequestUser) {
    return this.skillsService.clearGoal(user.id);
  }

  @Patch(':id')
  update(@CurrentUser() user: RequestUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateSkillDto) {
    return this.skillsService.update(user.id, id, dto);
  }

  @Delete(':id')
  remove(@CurrentUser() user: RequestUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.skillsService.remove(user.id, id);
  }
}
