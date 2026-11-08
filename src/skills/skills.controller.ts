import { Body, Controller, Delete, Get, Param, ParseUUIDPipe, Patch, Post, Put, Query, UseGuards } from '@nestjs/common';
import { CurrentUser } from '../user-auth/decorators/current-user.decorator.js';
import { UserAuthGuard } from '../user-auth/guards/user-auth.guard.js';
import { SetYearlyGoalDto } from '../common/yearly-goal.js';
import type { RequestUser } from '../user-auth/interfaces/request-user.interface.js';
import { CreateSkillDto } from './dto/create-skill.dto.js';
import {
  CreateSkillNoteDto,
  CreateSkillResourceDto,
  CreateSkillStepDto,
  LogPracticeDto,
  MoveSkillStepDto,
  PracticeRangeQueryDto,
  UpdateSkillNoteDto,
  UpdateSkillResourceDto,
  UpdateSkillStepDto,
} from './dto/skill-parts.dto.js';
import { UpdateSkillDto } from './dto/update-skill.dto.js';
import { SkillsService } from './skills.service.js';

// Habit Tracker -> Skills. User-scoped like BooksController (no :businessId).
@UseGuards(UserAuthGuard)
@Controller('api/skills')
export class SkillsController {
  constructor(private readonly skillsService: SkillsService) {}

  // Learning now, My skills and the dashboard in one call: the year, its
  // goal, the streaks, every skill with its summary and the last 400 days
  // of practice.
  @Get()
  overview(@CurrentUser() user: RequestUser) {
    return this.skillsService.overview(user.id);
  }

  @Post()
  create(@CurrentUser() user: RequestUser, @Body() dto: CreateSkillDto) {
    return this.skillsService.create(user.id, dto);
  }

  // Static segments, declared before the :id routes below.
  // Skills › Dashboard: the days of practice in another stretch of time.
  @Get('practice')
  practice(@CurrentUser() user: RequestUser, @Query() query: PracticeRangeQueryDto) {
    return this.skillsService.practice(user.id, query.from, query.to);
  }

  @Put('goal')
  setGoal(@CurrentUser() user: RequestUser, @Body() dto: SetYearlyGoalDto) {
    return this.skillsService.setGoal(user.id, dto);
  }

  @Delete('goal')
  clearGoal(@CurrentUser() user: RequestUser) {
    return this.skillsService.clearGoal(user.id);
  }

  // The skill page: the skill, every day of practice, the roadmap, notes and resources.
  @Get(':id')
  detail(@CurrentUser() user: RequestUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.skillsService.detail(user.id, id);
  }

  @Patch(':id')
  update(@CurrentUser() user: RequestUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateSkillDto) {
    return this.skillsService.update(user.id, id, dto);
  }

  @Delete(':id')
  remove(@CurrentUser() user: RequestUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.skillsService.remove(user.id, id);
  }

  // Undo a delete (within a day).
  @Post(':id/restore')
  restore(@CurrentUser() user: RequestUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.skillsService.restore(user.id, id);
  }

  // One day's practice, written or rewritten.
  @Put(':id/practice/:date')
  logPractice(@CurrentUser() user: RequestUser, @Param('id', ParseUUIDPipe) id: string, @Param('date') date: string, @Body() dto: LogPracticeDto) {
    return this.skillsService.logPractice(user.id, id, date, dto);
  }

  @Delete(':id/practice/:date')
  removePractice(@CurrentUser() user: RequestUser, @Param('id', ParseUUIDPipe) id: string, @Param('date') date: string) {
    return this.skillsService.removePractice(user.id, id, date);
  }

  @Post(':id/steps')
  addStep(@CurrentUser() user: RequestUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: CreateSkillStepDto) {
    return this.skillsService.addStep(user.id, id, dto);
  }

  @Patch(':id/steps/:stepId')
  updateStep(
    @CurrentUser() user: RequestUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('stepId', ParseUUIDPipe) stepId: string,
    @Body() dto: UpdateSkillStepDto,
  ) {
    return this.skillsService.updateStep(user.id, id, stepId, dto);
  }

  @Post(':id/steps/:stepId/move')
  moveStep(
    @CurrentUser() user: RequestUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('stepId', ParseUUIDPipe) stepId: string,
    @Body() dto: MoveSkillStepDto,
  ) {
    return this.skillsService.moveStep(user.id, id, stepId, dto.direction);
  }

  @Delete(':id/steps/:stepId')
  removeStep(@CurrentUser() user: RequestUser, @Param('id', ParseUUIDPipe) id: string, @Param('stepId', ParseUUIDPipe) stepId: string) {
    return this.skillsService.removeStep(user.id, id, stepId);
  }

  @Post(':id/notes')
  addNote(@CurrentUser() user: RequestUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: CreateSkillNoteDto) {
    return this.skillsService.addNote(user.id, id, dto);
  }

  @Patch(':id/notes/:noteId')
  updateNote(
    @CurrentUser() user: RequestUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('noteId', ParseUUIDPipe) noteId: string,
    @Body() dto: UpdateSkillNoteDto,
  ) {
    return this.skillsService.updateNote(user.id, id, noteId, dto);
  }

  @Delete(':id/notes/:noteId')
  removeNote(@CurrentUser() user: RequestUser, @Param('id', ParseUUIDPipe) id: string, @Param('noteId', ParseUUIDPipe) noteId: string) {
    return this.skillsService.removeNote(user.id, id, noteId);
  }

  @Post(':id/resources')
  addResource(@CurrentUser() user: RequestUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: CreateSkillResourceDto) {
    return this.skillsService.addResource(user.id, id, dto);
  }

  @Patch(':id/resources/:resourceId')
  updateResource(
    @CurrentUser() user: RequestUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('resourceId', ParseUUIDPipe) resourceId: string,
    @Body() dto: UpdateSkillResourceDto,
  ) {
    return this.skillsService.updateResource(user.id, id, resourceId, dto);
  }

  @Delete(':id/resources/:resourceId')
  removeResource(@CurrentUser() user: RequestUser, @Param('id', ParseUUIDPipe) id: string, @Param('resourceId', ParseUUIDPipe) resourceId: string) {
    return this.skillsService.removeResource(user.id, id, resourceId);
  }
}
