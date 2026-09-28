import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, SkillStatus, SkillUnit, type Skill } from '@prisma/client';
import { dhakaDateOnly, dhakaYear } from '../common/dhaka.js';
import { compareAndSwap, settleShelf, type ShelfItem, type ShelfMessages } from '../common/shelf.js';
import { cleanOptionalText, cleanRequiredText } from '../common/text.js';
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

const SHELVES = { todo: SkillStatus.WANT_TO_LEARN, doing: SkillStatus.LEARNING, done: SkillStatus.COMPLETED };
const MESSAGES: ShelfMessages = {
  overTotal: "Progress can't be more than the target",
  notStarted: "A skill you haven't started can't have progress",
};

function asShelfItem(skill: Skill): ShelfItem<SkillStatus> {
  return { status: skill.status, progress: skill.progress, startedAt: skill.startedAt, doneAt: skill.completedAt };
}

// The new column values for an edit of `current`, plus how much activity to
// record. Pure, so it can be re-run on a fresh read when a concurrent write is
// detected.
//
// Only progress the user reports is activity ("+10 minutes", "I'm on lesson
// 8"), and it counts even when sent together with a status. A move without a
// progress is not: nobody knows how much of the rest of a course was done
// today when it is marked Complete. The log is measured against
// `loggedProgress` -- the progress it last accounted for -- which a Complete
// jump leaves alone, so reporting the old progress again to undo a misclicked
// Complete logs nothing (rather than erasing the day's real activity). A move
// back to zero (Learn again, Want to learn) or a total edit that lowers it
// brings loggedProgress down with it: progress reported after a restart is
// new work.
function buildUpdate(current: Skill, dto: UpdateSkillDto, now: Date) {
  const name = dto.name !== undefined ? cleanRequiredText(dto.name, 'name', MAX_NAME_LENGTH) : current.name;
  const source = dto.source !== undefined ? cleanOptionalText(dto.source, 'source', MAX_SOURCE_LENGTH) : current.source;
  const target = dto.target ?? current.target;
  checkTarget(current.unit, target);
  const shelf = settleShelf(SHELVES, asShelfItem(current), { status: dto.status, progress: dto.progress, total: target }, now, MESSAGES);

  const reported = dto.progress !== undefined;
  const logDelta = reported ? shelf.progress - current.loggedProgress : 0;
  const loggedProgress = reported ? shelf.progress : Math.min(current.loggedProgress, shelf.progress);

  return {
    data: {
      name,
      source,
      target,
      progress: shelf.progress,
      loggedProgress,
      status: shelf.status,
      color: dto.color ?? current.color,
      icon: dto.icon ?? current.icon,
      startedAt: shelf.startedAt,
      completedAt: shelf.doneAt,
    },
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
    const today = dhakaDateOnly(now);
    const daysAgo = (n: number) => new Date(today.getTime() - n * DAY_MS).toISOString().slice(0, 10);

    // The chart needs amounts (and each skill's unit) for the last 7 days only.
    const recent = await this.prisma.skillLog.findMany({
      where: { userId, date: { gte: new Date(today.getTime() - 6 * DAY_MS) } },
      select: { date: true, amount: true, skill: { select: { unit: true } } },
    });
    const perDay = new Map<string, { minutes: number; lessons: number }>();
    for (const log of recent) {
      const key = log.date.toISOString().slice(0, 10);
      const day = perDay.get(key) ?? { minutes: 0, lessons: 0 };
      if (log.skill.unit === SkillUnit.HOURS) day.minutes += log.amount;
      else day.lessons += log.amount;
      perDay.set(key, day);
    }
    const week: WeekDay[] = [];
    for (let n = 6; n >= 0; n--) {
      const key = daysAgo(n);
      week.push({ date: key, minutes: perDay.get(key)?.minutes ?? 0, lessons: perDay.get(key)?.lessons ?? 0 });
    }

    // The streak only needs which days had any activity: one row per day.
    const activeDays = await this.prisma.skillLog.groupBy({
      by: ['date'],
      where: { userId, date: { gte: new Date(today.getTime() - STREAK_LOOKBACK_DAYS * DAY_MS) } },
    });
    const active = new Set(activeDays.map((row) => row.date.toISOString().slice(0, 10)));
    // Today counts if it has activity; otherwise the streak may still be alive
    // through yesterday (today just isn't over yet).
    let streak = 0;
    for (let n = active.has(daysAgo(0)) ? 0 : 1; n <= STREAK_LOOKBACK_DAYS && active.has(daysAgo(n)); n++) streak++;

    return { year, goalTarget: goal?.target ?? null, streak, week, skills: skills.map(toView) };
  }

  async create(userId: string, dto: CreateSkillDto): Promise<SkillView> {
    const name = cleanRequiredText(dto.name, 'name', MAX_NAME_LENGTH);
    const source = cleanOptionalText(dto.source ?? '', 'source', MAX_SOURCE_LENGTH);
    checkTarget(dto.unit, dto.target);
    const shelf = settleShelf(SHELVES, null, { status: dto.status, progress: dto.progress, total: dto.target }, new Date(), MESSAGES);
    if ((await this.prisma.skill.count({ where: { userId } })) >= MAX_SKILLS) {
      throw new BadRequestException(`You can keep up to ${MAX_SKILLS} skills`);
    }
    // No activity log entry: an initial progress here records ground already
    // covered before the skill was added (possibly long before today), not
    // something learned today -- so the log starts out accounting for it.
    const skill = await this.prisma.skill.create({
      data: {
        userId,
        name,
        source,
        unit: dto.unit,
        target: dto.target,
        progress: shelf.progress,
        loggedProgress: shelf.progress,
        status: shelf.status,
        color: dto.color ?? 'violet',
        icon: dto.icon ?? 'sparkles',
        startedAt: shelf.startedAt,
        completedAt: shelf.doneAt,
      },
    });
    return toView(skill);
  }

  // Every column is derived from the row as it was read, so the write only
  // lands if the row is unchanged (see compareAndSwap). The activity log moves
  // in the same transaction, so a lost race can't double-count it.
  async update(userId: string, id: string, dto: UpdateSkillDto): Promise<SkillView> {
    return compareAndSwap(async () => {
      const current = await this.requireSkill(userId, id);
      const now = new Date();
      const { data, logDelta } = buildUpdate(current, dto, now);
      const skill = await this.prisma.$transaction(async (tx) => {
        const updated = await tx.skill.update({ where: { id, userId, updatedAt: current.updatedAt }, data });
        if (logDelta !== 0) await this.adjustLog(tx, userId, id, logDelta, dhakaDateOnly(now));
        return updated;
      });
      return toView(skill);
    }, 'This skill was changed elsewhere -- please try again');
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
