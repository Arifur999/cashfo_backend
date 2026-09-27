import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, SkillStatus, SkillUnit, type Skill } from '@prisma/client';
import { dhakaDateKey, dhakaDateOnly, dhakaYear } from '../common/dhaka.js';
import { cleanText, INVISIBLE_ONLY } from '../common/text.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { CreateSkillDto } from './dto/create-skill.dto.js';
import { SetSkillGoalDto } from './dto/set-skill-goal.dto.js';
import { UpdateSkillDto } from './dto/update-skill.dto.js';

// A soft cap: the count and the insert are separate statements, so a burst of
// parallel requests can overshoot it slightly. It only guards against runaway
// data, not against a determined client.
const MAX_SKILLS = 200;

const MAX_NAME_LENGTH = 120;
const MAX_SOURCE_LENGTH = 80;

// Per-unit ceiling for `target`: lessons for a course, MINUTES for hours.
const MAX_LESSONS = 2000;
const MAX_MINUTES = 60000; // 1000 hours

const DAY_MS = 24 * 60 * 60 * 1000;
const STREAK_LOOKBACK_DAYS = 400;

function cleanName(value: string): string {
  const name = cleanText(value, 'name', MAX_NAME_LENGTH);
  if (INVISIBLE_ONLY.test(name)) throw new BadRequestException('A name is required');
  return name;
}

function cleanSource(value: string): string {
  const source = cleanText(value, 'source', MAX_SOURCE_LENGTH);
  return INVISIBLE_ONLY.test(source) ? '' : source;
}

function checkTarget(unit: SkillUnit, target: number): void {
  if (unit === SkillUnit.LESSONS && target > MAX_LESSONS) {
    throw new BadRequestException(`A course can have up to ${MAX_LESSONS} lessons`);
  }
  if (unit === SkillUnit.HOURS && target > MAX_MINUTES) {
    throw new BadRequestException(`A goal can be up to ${MAX_MINUTES / 60} hours`);
  }
}

export interface SkillView {
  id: string;
  name: string;
  source: string;
  unit: SkillUnit;
  target: number; // lessons, or minutes for HOURS
  progress: number; // same unit
  status: SkillStatus;
  color: string;
  icon: string;
  startedAt: string | null;
  completedAt: string | null;
  // Asia/Dhaka calendar year of completedAt -- so the client never has to guess
  // the timezone when counting "completed this year".
  completedYear: number | null;
  createdAt: string;
  updatedAt: string;
}

export interface WeekDay {
  date: string; // 'YYYY-MM-DD' (Asia/Dhaka)
  minutes: number; // learned that day in HOURS skills
  lessons: number; // learned that day in LESSONS skills
}

export interface SkillsOverview {
  year: number; // the current Asia/Dhaka year
  goalTarget: number | null; // this year's "complete N skills" goal
  streak: number; // consecutive days with any activity, up to today
  week: WeekDay[]; // the last 7 days, oldest first, ending today
  skills: SkillView[];
}

function toView(skill: Skill): SkillView {
  return {
    id: skill.id,
    name: skill.name,
    source: skill.source,
    unit: skill.unit,
    target: skill.target,
    progress: skill.progress,
    status: skill.status,
    color: skill.color,
    icon: skill.icon,
    startedAt: skill.startedAt?.toISOString() ?? null,
    completedAt: skill.completedAt?.toISOString() ?? null,
    completedYear: skill.completedAt ? dhakaYear(skill.completedAt) : null,
    createdAt: skill.createdAt.toISOString(),
    updatedAt: skill.updatedAt.toISOString(),
  };
}

// The shelf a skill sits on follows from how far the learner is, unless they
// explicitly moved it (`statusRequested`):
//  - moved to COMPLETED           -> everything done
//  - moved to WANT_TO_LEARN       -> back to zero
//  - moved to LEARNING            -> (re)start: a completed skill starts over at zero
//  - otherwise, from the progress: all done -> COMPLETED, some -> LEARNING,
//    none -> stays where it was (a completed skill dropped to 0 is LEARNING).
function settle(status: SkillStatus, progress: number, target: number, statusRequested: boolean): { status: SkillStatus; progress: number } {
  if (statusRequested) {
    if (status === SkillStatus.COMPLETED) return { status, progress: target };
    if (status === SkillStatus.WANT_TO_LEARN) return { status, progress: 0 };
    return { status, progress: progress >= target ? 0 : progress };
  }
  if (progress >= target) return { status: SkillStatus.COMPLETED, progress: target };
  if (progress > 0) return { status: SkillStatus.LEARNING, progress };
  return { status: status === SkillStatus.COMPLETED ? SkillStatus.LEARNING : status, progress: 0 };
}

function settleDates(current: Pick<Skill, 'status' | 'startedAt' | 'completedAt'> | null, next: SkillStatus, now: Date): { startedAt: Date | null; completedAt: Date | null } {
  let startedAt = current?.startedAt ?? null;
  if (next === SkillStatus.WANT_TO_LEARN) {
    startedAt = null;
  } else if (startedAt === null || (current?.status === SkillStatus.COMPLETED && next !== SkillStatus.COMPLETED)) {
    startedAt = now;
  }
  const completedAt = next === SkillStatus.COMPLETED ? (current?.completedAt ?? now) : null;
  return { startedAt, completedAt };
}

// The new column values for an edit of `current`, plus how much activity to
// record. Pure, so it can be re-run on a fresh read when a concurrent write is
// detected.
function buildUpdate(current: Skill, dto: UpdateSkillDto, now: Date) {
  const name = dto.name !== undefined ? cleanName(dto.name) : current.name;
  const source = dto.source !== undefined ? cleanSource(dto.source) : current.source;
  const target = dto.target ?? current.target;
  checkTarget(current.unit, target);
  if (dto.progress !== undefined && dto.progress > target) {
    throw new BadRequestException("Progress can't be more than the target");
  }

  // Editing only the details of a completed skill (say, correcting its lesson
  // count) keeps it completed, rather than reopening it at the old progress.
  const keepCompleted = current.status === SkillStatus.COMPLETED && dto.progress === undefined && (dto.status === undefined || dto.status === SkillStatus.COMPLETED);
  const progress = keepCompleted ? target : (dto.progress ?? current.progress);

  const statusRequested = dto.status !== undefined && dto.status !== current.status;
  const settled = settle(dto.status ?? current.status, progress, target, statusRequested);
  const dates = settleDates(current, settled.status, now);

  // Only an explicit progress change is "activity" (+10 minutes, "I'm on
  // lesson 8"). Finishing or restarting a skill by changing its status is not:
  // nobody knows how much of the rest was done today. A target edit that
  // clamps progress up or down (a count fix) isn't activity either -- it
  // relabels the goalpost, it doesn't record new work -- so today's log can
  // end up not matching the skill's current progress after one; that's the
  // log staying an accurate record of what was reported that day, not a bug.
  const logDelta = dto.progress !== undefined && !statusRequested ? settled.progress - current.progress : 0;

  return {
    data: { name, source, target, progress: settled.progress, status: settled.status, color: dto.color ?? current.color, icon: dto.icon ?? current.icon, ...dates },
    logDelta,
  };
}

@Injectable()
export class SkillsService {
  constructor(private readonly prisma: PrismaService) {}

  async overview(userId: string): Promise<SkillsOverview> {
    const now = new Date();
    const year = dhakaYear(now);
    // One after the other, not Promise.all: the local dev database (`prisma dev`)
    // drops the connection when two queries run at once (P1017).
    const skills = await this.prisma.skill.findMany({ where: { userId }, orderBy: { updatedAt: 'desc' } });
    const goal = await this.prisma.skillGoal.findUnique({ where: { userId_year: { userId, year } } });
    const logs = await this.prisma.skillLog.findMany({
      where: { userId, date: { gte: new Date(dhakaDateOnly(now).getTime() - STREAK_LOOKBACK_DAYS * DAY_MS) } },
      select: { date: true, amount: true, skill: { select: { unit: true } } },
    });

    const perDay = new Map<string, { minutes: number; lessons: number }>();
    for (const log of logs) {
      const key = log.date.toISOString().slice(0, 10);
      const day = perDay.get(key) ?? { minutes: 0, lessons: 0 };
      if (log.skill.unit === SkillUnit.HOURS) day.minutes += log.amount;
      else day.lessons += log.amount;
      perDay.set(key, day);
    }
    const keyDaysAgo = (n: number) => dhakaDateKey(new Date(now.getTime() - n * DAY_MS));

    const week: WeekDay[] = [];
    for (let n = 6; n >= 0; n--) {
      const key = keyDaysAgo(n);
      week.push({ date: key, minutes: perDay.get(key)?.minutes ?? 0, lessons: perDay.get(key)?.lessons ?? 0 });
    }

    // Today counts if it has activity; otherwise the streak may still be alive
    // through yesterday (today just isn't over yet).
    let streak = 0;
    for (let n = perDay.has(keyDaysAgo(0)) ? 0 : 1; n <= STREAK_LOOKBACK_DAYS && perDay.has(keyDaysAgo(n)); n++) streak++;

    return { year, goalTarget: goal?.target ?? null, streak, week, skills: skills.map(toView) };
  }

  async create(userId: string, dto: CreateSkillDto): Promise<SkillView> {
    const name = cleanName(dto.name);
    const source = cleanSource(dto.source ?? '');
    checkTarget(dto.unit, dto.target);

    const progress = dto.progress ?? 0;
    if (progress > dto.target) {
      throw new BadRequestException("Progress can't be more than the target");
    }
    if (dto.status === SkillStatus.WANT_TO_LEARN && progress > 0) {
      throw new BadRequestException("A skill you haven't started can't have progress");
    }
    if ((await this.prisma.skill.count({ where: { userId } })) >= MAX_SKILLS) {
      throw new BadRequestException(`You can keep up to ${MAX_SKILLS} skills`);
    }

    // COMPLETED and WANT_TO_LEARN are explicit shelves; LEARNING (or no status)
    // follows the progress -- so 24 of 24 is a completed course, not a restart.
    const statusRequested = dto.status === SkillStatus.COMPLETED || dto.status === SkillStatus.WANT_TO_LEARN;
    const settled = settle(dto.status ?? SkillStatus.WANT_TO_LEARN, progress, dto.target, statusRequested);
    const dates = settleDates(null, settled.status, new Date());
    // No activity log entry: an initial progress here records ground already
    // covered before the skill was added (possibly long before today), not
    // something learned today -- unlike update()'s progress changes.
    const skill = await this.prisma.skill.create({
      data: {
        userId,
        name,
        source,
        unit: dto.unit,
        target: dto.target,
        progress: settled.progress,
        status: settled.status,
        color: dto.color ?? 'violet',
        icon: dto.icon ?? 'sparkles',
        ...dates,
      },
    });
    return toView(skill);
  }

  // Every column is derived from the row as it was read, so the write is a
  // compare-and-swap on updatedAt: if another request changed the skill in
  // between, re-read and re-derive instead of overwriting its change with
  // stale values. The activity log moves in the same transaction, so a lost
  // race can't double-count it.
  async update(userId: string, id: string, dto: UpdateSkillDto): Promise<SkillView> {
    for (let attempt = 0; attempt < 3; attempt++) {
      const current = await this.requireSkill(userId, id);
      const now = new Date();
      const { data, logDelta } = buildUpdate(current, dto, now);
      const applied = await this.prisma.$transaction(async (tx) => {
        const { count } = await tx.skill.updateMany({ where: { id, userId, updatedAt: current.updatedAt }, data });
        if (count !== 1) return false;
        if (logDelta !== 0) await this.adjustLog(tx, userId, id, logDelta, dhakaDateOnly(now));
        return true;
      });
      if (applied) return toView(await this.requireSkill(userId, id));
    }
    throw new ConflictException('This skill was changed elsewhere -- please try again');
  }

  async remove(userId: string, id: string): Promise<{ id: string }> {
    const { count } = await this.prisma.skill.deleteMany({ where: { id, userId } });
    if (count === 0) throw new NotFoundException('Skill not found');
    return { id };
  }

  async setGoal(userId: string, dto: SetSkillGoalDto): Promise<{ year: number; goalTarget: number | null }> {
    const year = dhakaYear(new Date());
    await this.prisma.skillGoal.upsert({
      where: { userId_year: { userId, year } },
      update: { target: dto.target },
      create: { userId, year, target: dto.target },
    });
    return { year, goalTarget: dto.target };
  }

  async clearGoal(userId: string): Promise<{ year: number; goalTarget: number | null }> {
    const year = dhakaYear(new Date());
    await this.prisma.skillGoal.deleteMany({ where: { userId, year } });
    return { year, goalTarget: null };
  }

  // Today's activity row for a skill: an increase adds to it, a decrease takes
  // away from it (an undone +30 minutes) down to zero, where the row goes.
  private async adjustLog(tx: Prisma.TransactionClient, userId: string, skillId: string, delta: number, date: Date): Promise<void> {
    if (delta > 0) {
      await tx.skillLog.upsert({
        where: { skillId_date: { skillId, date } },
        update: { amount: { increment: delta } },
        create: { skillId, userId, date, amount: delta },
      });
      return;
    }
    const row = await tx.skillLog.findUnique({ where: { skillId_date: { skillId, date } } });
    if (!row) return;
    const next = row.amount + delta;
    if (next <= 0) await tx.skillLog.delete({ where: { id: row.id } });
    else await tx.skillLog.update({ where: { id: row.id }, data: { amount: next } });
  }

  private async requireSkill(userId: string, id: string): Promise<Skill> {
    const skill = await this.prisma.skill.findFirst({ where: { id, userId } });
    if (!skill) throw new NotFoundException('Skill not found');
    return skill;
  }
}
