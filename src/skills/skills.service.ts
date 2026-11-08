import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, SkillStatus, SkillUnit, type Skill, type SkillLog, type SkillNote, type SkillResource, type SkillStep } from '@prisma/client';
import { dhakaDateKey, dhakaYear } from '../common/dhaka.js';
import { cleanLongText } from '../common/long-text.js';
import { cleanOptionalText, cleanRequiredText } from '../common/text.js';
import { createWithinCap } from '../common/user-cap.js';
import { clearYearlyGoal, setYearlyGoal, type SetYearlyGoalDto, type YearlyGoal } from '../common/yearly-goal.js';
import { finishedOn, isRealDay, pastDay } from '../books/library.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { CreateSkillDto } from './dto/create-skill.dto.js';
import {
  CreateSkillNoteDto,
  CreateSkillResourceDto,
  CreateSkillStepDto,
  LogPracticeDto,
  UpdateSkillNoteDto,
  UpdateSkillResourceDto,
  UpdateSkillStepDto,
} from './dto/skill-parts.dto.js';
import { UpdateSkillDto } from './dto/update-skill.dto.js';
import { SKILL_LIMITS } from './skill-options.js';
import { checkPractice, checkTarget, cleanLink, maxCount, moveShelf, noteTitle, practiceRuns, progressOf } from './skill-rules.js';

const DAY_MS = 24 * 60 * 60 * 1000;
// The overview carries this many days of practice (the dashboard's half
// year of squares and this year's months, with room to spare).
const LOG_DAYS = 400;
// GET practice reads at most about three years at once.
const MAX_RANGE_DAYS = 3 * 366;

const dayKey = (date: Date): string => date.toISOString().slice(0, 10);
const asDate = (day: string): Date => new Date(`${day}T00:00:00.000Z`);

export interface SkillView {
  id: string;
  name: string;
  source: string;
  unit: SkillUnit;
  target: number; // lessons or chapters, or minutes for HOURS
  progress: number; // same unit
  status: SkillStatus;
  color: string;
  icon: string;
  category: string;
  link: string;
  why: string;
  targetDate: string | null; // YYYY-MM-DD
  pausedAt: string | null;
  base: number;
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
  lessons: number; // learned that day in LESSONS and CHAPTERS skills
  // That day's amount per skill (id -> lessons, or minutes), for a per-skill grid.
  bySkill: Record<string, number>;
}

// What the list pages show of each skill beyond its row.
export interface SkillSummary {
  sessions: number; // days with practice
  logged: number; // all of it, in the unit
  lastPractised: string | null; // YYYY-MM-DD
  steps: { done: number; total: number; next: string | null };
  lastNote: { title: string; text: string; date: string } | null;
  notes: number;
  resources: number;
}

export interface SkillsOverview {
  year: number; // the current Asia/Dhaka year
  goalTarget: number | null; // this year's "complete N skills" goal
  streak: number; // consecutive days with any practice, up to today
  bestStreak: number; // the longest such run ever
  week: WeekDay[]; // the last 7 days, oldest first, ending today
  skills: SkillView[];
  summaries: Record<string, SkillSummary>;
  // Every day of practice in the last 400 days, oldest first.
  logs: { skillId: string; date: string; amount: number }[];
}

export interface PracticeEntryView {
  date: string;
  amount: number;
  note: string;
}

export interface SkillDetail {
  skill: SkillView;
  // Every day of practice, newest first.
  logs: PracticeEntryView[];
  steps: { id: string; title: string; position: number; done: boolean; doneOn: string | null }[];
  // Newest first.
  notes: { id: string; date: string; title: string; text: string; createdAt: string }[];
  resources: { id: string; kind: SkillResource['kind']; title: string; url: string }[];
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
    category: skill.category,
    link: skill.link,
    why: skill.why,
    targetDate: skill.targetDate ? dayKey(skill.targetDate) : null,
    pausedAt: skill.pausedAt?.toISOString() ?? null,
    base: skill.base,
    startedAt: skill.startedAt?.toISOString() ?? null,
    completedAt: skill.completedAt?.toISOString() ?? null,
    completedYear: skill.completedAt ? dhakaYear(skill.completedAt) : null,
    createdAt: skill.createdAt.toISOString(),
    updatedAt: skill.updatedAt.toISOString(),
  };
}

const toEntry = (log: SkillLog): PracticeEntryView => ({ date: dayKey(log.date), amount: log.amount, note: log.note });
const toStep = (step: SkillStep) => ({
  id: step.id,
  title: step.title,
  position: step.position,
  done: step.done,
  doneOn: step.doneOn ? dayKey(step.doneOn) : null,
});
const toNote = (note: SkillNote) => ({ id: note.id, date: dayKey(note.date), title: note.title, text: note.text, createdAt: note.createdAt.toISOString() });
const toResource = (resource: SkillResource) => ({ id: resource.id, kind: resource.kind, title: resource.title, url: resource.url });

// A target date the reader may set: a real day, from the day the skill was
// started (or today, for one not started) on.
function cleanTargetDate(value: string | null | undefined, startedAt: Date | null, today: string): Date | null | undefined {
  if (value === undefined) return undefined;
  if (value === null) return null;
  if (!isRealDay(value)) throw new BadRequestException('Pick a real target date');
  const earliest = startedAt ? dhakaDateKey(startedAt) : today;
  if (value < earliest) throw new BadRequestException(startedAt ? 'Pick a target date after the start' : 'Pick today or a later date');
  return asDate(value);
}

@Injectable()
export class SkillsService {
  constructor(private readonly prisma: PrismaService) {}

  async overview(userId: string): Promise<SkillsOverview> {
    const now = new Date();
    const year = dhakaYear(now);
    const today = dhakaDateKey(now);
    const live = { userId, deletedAt: null };
    // One after the other, not Promise.all: the local dev database (`prisma dev`)
    // drops the connection when two queries run at once (P1017).
    const skills = await this.prisma.skill.findMany({ where: live, orderBy: { updatedAt: 'desc' } });
    const goal = await this.prisma.skillGoal.findUnique({ where: { userId_year: { userId, year } } });
    const logs = await this.prisma.skillLog.findMany({
      where: { userId, skill: { deletedAt: null }, date: { gte: asDate(dayKey(new Date(asDate(today).getTime() - LOG_DAYS * DAY_MS))) } },
      orderBy: { date: 'asc' },
      select: { skillId: true, date: true, amount: true },
    });
    const totals = await this.prisma.skillLog.groupBy({
      by: ['skillId'],
      where: { userId, skill: { deletedAt: null } },
      _count: { _all: true },
      _sum: { amount: true },
      _max: { date: true },
    });
    const days = await this.prisma.skillLog.groupBy({ by: ['date'], where: { userId, skill: { deletedAt: null } } });
    const steps = await this.prisma.skillStep.findMany({
      where: { skill: live },
      orderBy: { position: 'asc' },
      select: { skillId: true, title: true, done: true },
    });
    const lastNotes = await this.prisma.$queryRaw<{ skillId: string; title: string; text: string; date: Date }[]>`
      SELECT DISTINCT ON (n."skillId") n."skillId", n."title", left(n."text", 200) AS "text", n."date"
      FROM "SkillNote" n JOIN "Skill" s ON s."id" = n."skillId"
      WHERE s."userId" = ${userId} AND s."deletedAt" IS NULL
      ORDER BY n."skillId", n."date" DESC, n."createdAt" DESC`;

    const noteCounts = await this.prisma.skillNote.groupBy({ by: ['skillId'], where: { skill: live }, _count: { _all: true } });
    const resourceCounts = await this.prisma.skillResource.groupBy({ by: ['skillId'], where: { skill: live }, _count: { _all: true } });

    const unitOf = new Map(skills.map((skill) => [skill.id, skill.unit]));
    const week: WeekDay[] = Array.from({ length: 7 }, (_, i) => ({
      date: dayKey(new Date(asDate(today).getTime() - (6 - i) * DAY_MS)),
      minutes: 0,
      lessons: 0,
      bySkill: {},
    }));
    for (const log of logs) {
      const day = week.find((d) => d.date === dayKey(log.date));
      if (!day) continue;
      if (unitOf.get(log.skillId) === SkillUnit.HOURS) day.minutes += log.amount;
      else day.lessons += log.amount;
      day.bySkill[log.skillId] = (day.bySkill[log.skillId] ?? 0) + log.amount;
    }

    const summaries: Record<string, SkillSummary> = {};
    for (const skill of skills) {
      const total = totals.find((row) => row.skillId === skill.id);
      const mine = steps.filter((step) => step.skillId === skill.id);
      const note = lastNotes.find((row) => row.skillId === skill.id);
      summaries[skill.id] = {
        sessions: total?._count._all ?? 0,
        logged: total?._sum.amount ?? 0,
        lastPractised: total?._max.date ? dayKey(total._max.date) : null,
        steps: { done: mine.filter((step) => step.done).length, total: mine.length, next: mine.find((step) => !step.done)?.title ?? null },
        lastNote: note ? { title: note.title, text: note.text, date: dayKey(note.date) } : null,
        notes: noteCounts.find((row) => row.skillId === skill.id)?._count._all ?? 0,
        resources: resourceCounts.find((row) => row.skillId === skill.id)?._count._all ?? 0,
      };
    }

    const runs = practiceRuns(
      days.map((row) => dayKey(row.date)),
      today,
    );
    return {
      year,
      goalTarget: goal?.target ?? null,
      streak: runs.streak,
      bestStreak: runs.best,
      week,
      skills: skills.map(toView),
      summaries,
      logs: logs.map((log) => ({ skillId: log.skillId, date: dayKey(log.date), amount: log.amount })),
    };
  }

  // Skills › Dashboard: every day of practice from one day to another.
  async practice(userId: string, from: string, to: string): Promise<{ from: string; to: string; logs: { skillId: string; date: string; amount: number }[] }> {
    if (!isRealDay(from) || !isRealDay(to)) throw new BadRequestException('Pick real dates');
    if (from > to) throw new BadRequestException('The first date must come before the last');
    if ((Date.parse(to) - Date.parse(from)) / DAY_MS > MAX_RANGE_DAYS) throw new BadRequestException('Pick at most three years at a time');
    const logs = await this.prisma.skillLog.findMany({
      where: { userId, skill: { deletedAt: null }, date: { gte: asDate(from), lte: asDate(to) } },
      orderBy: { date: 'asc' },
      select: { skillId: true, date: true, amount: true },
    });
    return { from, to, logs: logs.map((log) => ({ skillId: log.skillId, date: dayKey(log.date), amount: log.amount })) };
  }

  async detail(userId: string, id: string): Promise<SkillDetail> {
    const skill = await this.requireSkill(userId, id);
    const logs = await this.prisma.skillLog.findMany({ where: { skillId: id }, orderBy: { date: 'desc' } });
    const steps = await this.prisma.skillStep.findMany({ where: { skillId: id }, orderBy: { position: 'asc' } });
    const notes = await this.prisma.skillNote.findMany({ where: { skillId: id }, orderBy: [{ date: 'desc' }, { createdAt: 'desc' }] });
    const resources = await this.prisma.skillResource.findMany({ where: { skillId: id }, orderBy: { createdAt: 'asc' } });
    return { skill: toView(skill), logs: logs.map(toEntry), steps: steps.map(toStep), notes: notes.map(toNote), resources: resources.map(toResource) };
  }

  async create(userId: string, dto: CreateSkillDto): Promise<SkillView> {
    const now = new Date();
    const name = cleanRequiredText(dto.name, 'name', SKILL_LIMITS.name);
    const source = cleanOptionalText(dto.source ?? '', 'source', SKILL_LIMITS.source);
    checkTarget(dto.unit, dto.target);
    const base = dto.base ?? dto.progress ?? 0;
    if (base > dto.target) throw new BadRequestException("What is already done can't be more than the total");
    const shelf = moveShelf(
      { status: SkillStatus.WANT_TO_LEARN, pausedAt: null, startedAt: null, completedAt: null },
      { status: dto.status ?? SkillStatus.WANT_TO_LEARN, paused: dto.paused },
      now,
    );
    const targetDate = cleanTargetDate(dto.targetDate, shelf.startedAt, dhakaDateKey(now)) ?? null;
    await this.checkName(userId, name, null);
    const skill = await createWithinCap(
      this.prisma,
      userId,
      'skills',
      SKILL_LIMITS.skills,
      `You can keep up to ${SKILL_LIMITS.skills} skills`,
      (tx) => tx.skill.count({ where: { userId, deletedAt: null } }),
      (tx) =>
        tx.skill.create({
          data: {
            userId,
            name,
            source,
            unit: dto.unit,
            target: dto.target,
            base,
            progress: progressOf(shelf.status, dto.target, base, 0),
            loggedProgress: base,
            ...shelf,
            color: dto.color ?? 'violet',
            icon: dto.icon ?? 'sparkles',
            category: dto.category ?? 'life',
            link: cleanLink(dto.link ?? ''),
            why: cleanOptionalText(dto.why ?? '', 'reason', SKILL_LIMITS.why),
            targetDate,
          },
        }),
    );
    return toView(skill);
  }

  // A details edit, a new total or a move to another shelf. The progress is
  // worked out again from what is logged, in one transaction with the row
  // lock, so a day's practice saved at the same time is counted.
  async update(userId: string, id: string, dto: UpdateSkillDto): Promise<SkillView> {
    const now = new Date();
    return this.prisma.$transaction(async (tx) => {
      const current = await this.lockSkill(tx, userId, id);
      const logged = await this.loggedTotal(tx, id);
      const name = dto.name !== undefined ? cleanRequiredText(dto.name, 'name', SKILL_LIMITS.name) : current.name;
      if (dto.name !== undefined) await this.checkName(userId, name, id, tx);
      const unit = dto.unit ?? current.unit;
      if (unit !== current.unit && (await tx.skillLog.count({ where: { skillId: id } })) > 0)
        throw new BadRequestException('Practice is already logged, so the unit can not change');
      const target = dto.target ?? current.target;
      checkTarget(unit, target);
      let base = dto.base ?? current.base;
      // The older "I'm on lesson 8": where the skill is, not what came before.
      if (dto.progress !== undefined && dto.base === undefined) base = Math.max(0, dto.progress - logged);
      if (base > maxCount(unit)) throw new BadRequestException('That is more than a skill can hold');
      if (base > target) throw new BadRequestException("What is already done can't be more than the total");
      const shelf = moveShelf(current, { status: dto.status, paused: dto.paused }, now);
      const targetDate = cleanTargetDate(dto.targetDate, shelf.startedAt, dhakaDateKey(now));
      const saved = await tx.skill.update({
        where: { id },
        data: {
          name,
          source: dto.source !== undefined ? cleanOptionalText(dto.source, 'source', SKILL_LIMITS.source) : current.source,
          unit,
          target,
          base,
          progress: progressOf(shelf.status, target, base, logged),
          ...shelf,
          color: dto.color ?? current.color,
          icon: dto.icon ?? current.icon,
          category: dto.category ?? current.category,
          link: dto.link !== undefined ? cleanLink(dto.link) : current.link,
          why: dto.why !== undefined ? cleanOptionalText(dto.why, 'reason', SKILL_LIMITS.why) : current.why,
          ...(targetDate !== undefined ? { targetDate } : {}),
        },
      });
      return toView(saved);
    });
  }

  // Deleted for now: the skill and everything in it stay a day, so the
  // delete can be undone (restore); housekeeping clears them after. Its
  // reminders go at once (Reminder.targetKey is no foreign key).
  async remove(userId: string, id: string): Promise<{ id: string }> {
    const [{ count }] = await this.prisma.$transaction([
      this.prisma.skill.updateMany({ where: { id, userId, deletedAt: null }, data: { deletedAt: new Date() } }),
      this.prisma.reminder.deleteMany({ where: { userId, kind: 'SKILL', targetKey: id } }),
    ]);
    if (count === 0) throw new NotFoundException('Skill not found');
    return { id };
  }

  async restore(userId: string, id: string): Promise<SkillView> {
    const skill = await this.prisma.skill.findFirst({ where: { id, userId, deletedAt: { not: null } } });
    if (!skill || !skill.deletedAt || Date.now() - skill.deletedAt.getTime() > SKILL_LIMITS.undoMs)
      throw new NotFoundException('This skill can no longer be brought back');
    await this.checkName(userId, skill.name, id);
    const restored = await createWithinCap(
      this.prisma,
      userId,
      'skills',
      SKILL_LIMITS.skills,
      `You can keep up to ${SKILL_LIMITS.skills} skills`,
      (tx) => tx.skill.count({ where: { userId, deletedAt: null } }),
      (tx) => tx.skill.update({ where: { id }, data: { deletedAt: null } }),
    );
    return toView(restored);
  }

  // The skills deleted long enough ago that no undo can reach them.
  async purgeDeleted(now: Date): Promise<number> {
    const { count } = await this.prisma.skill.deleteMany({ where: { deletedAt: { lt: new Date(now.getTime() - SKILL_LIMITS.undoMs) } } });
    return count;
  }

  // One day's practice: written, or rewritten when that day has one. A
  // skill not started starts that day; a paused one is taken up again; at
  // the end it is completed unless `finish` is false.
  async logPractice(userId: string, id: string, day: string, dto: LogPracticeDto): Promise<{ skill: SkillView; entry: PracticeEntryView }> {
    const now = new Date();
    const today = dhakaDateKey(now);
    const date = pastDay(day, today);
    const note = cleanLongText(dto.note ?? '', 'note', SKILL_LIMITS.practiceNote);
    return this.prisma.$transaction(async (tx) => {
      const skill = await this.lockSkill(tx, userId, id);
      if (skill.startedAt && date < dhakaDateKey(skill.startedAt))
        throw new BadRequestException(`You started this skill on ${dhakaDateKey(skill.startedAt)}. Pick that day or later`);
      const existing = await tx.skillLog.findUnique({ where: { skillId_date: { skillId: id, date: asDate(date) } } });
      const others = skill.base + (await this.loggedTotal(tx, id)) - (existing?.amount ?? 0);
      checkPractice(skill.unit, dto.amount, skill.target, others);
      const entry = await tx.skillLog.upsert({
        where: { skillId_date: { skillId: id, date: asDate(date) } },
        update: { amount: dto.amount, note },
        create: { skillId: id, userId, date: asDate(date), amount: dto.amount, note },
      });
      const reached = others + dto.amount >= skill.target;
      const status = skill.status === SkillStatus.COMPLETED || (reached && dto.finish !== false) ? SkillStatus.COMPLETED : SkillStatus.LEARNING;
      const startedAt = skill.startedAt ?? finishedOn(date, today, now);
      const saved = await tx.skill.update({
        where: { id },
        data: {
          status,
          startedAt,
          pausedAt: null,
          completedAt: status === SkillStatus.COMPLETED ? (skill.completedAt ?? finishedOn(date, today, now)) : null,
          progress: progressOf(status, skill.target, skill.base, others - skill.base + dto.amount),
        },
      });
      return { skill: toView(saved), entry: toEntry(entry) };
    });
  }

  async removePractice(userId: string, id: string, day: string): Promise<SkillView> {
    if (!isRealDay(day)) throw new BadRequestException('Pick a real date');
    return this.prisma.$transaction(async (tx) => {
      const skill = await this.lockSkill(tx, userId, id);
      const { count } = await tx.skillLog.deleteMany({ where: { skillId: id, date: asDate(day) } });
      if (count === 0) throw new NotFoundException('No practice on that day');
      const saved = await tx.skill.update({
        where: { id },
        data: { progress: progressOf(skill.status, skill.target, skill.base, await this.loggedTotal(tx, id)) },
      });
      return toView(saved);
    });
  }

  // --- The roadmap ---

  async addStep(userId: string, id: string, dto: CreateSkillStepDto) {
    await this.requireSkill(userId, id);
    const title = cleanRequiredText(dto.title, 'step', SKILL_LIMITS.stepTitle);
    const today = dhakaDateKey(new Date());
    const step = await createWithinCap(
      this.prisma,
      id,
      'skill-steps',
      SKILL_LIMITS.steps,
      `A roadmap can have up to ${SKILL_LIMITS.steps} steps`,
      (tx) => tx.skillStep.count({ where: { skillId: id } }),
      async (tx) => {
        const steps = await tx.skillStep.findMany({ where: { skillId: id }, orderBy: { position: 'asc' }, select: { id: true } });
        const at = Math.min(dto.position ?? steps.length, steps.length);
        // Make room, keeping the order the steps had.
        for (const [i, step] of steps.entries()) if (i >= at) await tx.skillStep.update({ where: { id: step.id }, data: { position: i + 1 } });
        const done = dto.done ?? false;
        return tx.skillStep.create({
          data: { skillId: id, title, position: at, done, doneOn: done ? asDate(dto.doneOn && isRealDay(dto.doneOn) ? dto.doneOn : today) : null },
        });
      },
    );
    return toStep(step);
  }

  async updateStep(userId: string, id: string, stepId: string, dto: UpdateSkillStepDto) {
    await this.requireSkill(userId, id);
    const step = await this.prisma.skillStep.findFirst({ where: { id: stepId, skillId: id } });
    if (!step) throw new NotFoundException('Step not found');
    const done = dto.done ?? step.done;
    const saved = await this.prisma.skillStep.update({
      where: { id: stepId },
      data: {
        title: dto.title !== undefined ? cleanRequiredText(dto.title, 'step', SKILL_LIMITS.stepTitle) : step.title,
        done,
        doneOn: done ? (step.done ? step.doneOn : asDate(dhakaDateKey(new Date()))) : null,
      },
    });
    return toStep(saved);
  }

  // Swap a step with the one above or below it.
  async moveStep(userId: string, id: string, stepId: string, direction: 'up' | 'down') {
    await this.requireSkill(userId, id);
    return this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`skill-steps:${id}`}))`;
      const steps = await tx.skillStep.findMany({ where: { skillId: id }, orderBy: [{ position: 'asc' }, { createdAt: 'asc' }] });
      const at = steps.findIndex((step) => step.id === stepId);
      if (at < 0) throw new NotFoundException('Step not found');
      const to = direction === 'up' ? at - 1 : at + 1;
      if (to < 0 || to >= steps.length) return steps.map(toStep);
      [steps[at], steps[to]] = [steps[to], steps[at]];
      for (const [i, step] of steps.entries()) if (step.position !== i) await tx.skillStep.update({ where: { id: step.id }, data: { position: i } });
      return steps.map((step, i) => toStep({ ...step, position: i }));
    });
  }

  async removeStep(userId: string, id: string, stepId: string): Promise<{ id: string }> {
    await this.requireSkill(userId, id);
    const { count } = await this.prisma.skillStep.deleteMany({ where: { id: stepId, skillId: id } });
    if (count === 0) throw new NotFoundException('Step not found');
    return { id: stepId };
  }

  // --- Notes ---

  async addNote(userId: string, id: string, dto: CreateSkillNoteDto) {
    await this.requireSkill(userId, id);
    const text = cleanLongText(dto.text, 'note', SKILL_LIMITS.noteText);
    if (!text) throw new BadRequestException('Write the note first');
    const title = noteTitle(cleanOptionalText(dto.title ?? '', 'title', SKILL_LIMITS.noteTitle), text);
    const today = dhakaDateKey(new Date());
    const date = pastDay(dto.date ?? today, today);
    const note = await createWithinCap(
      this.prisma,
      id,
      'skill-notes',
      SKILL_LIMITS.notes,
      `A skill can keep up to ${SKILL_LIMITS.notes} notes`,
      (tx) => tx.skillNote.count({ where: { skillId: id } }),
      (tx) => tx.skillNote.create({ data: { skillId: id, date: asDate(date), title, text } }),
    );
    return toNote(note);
  }

  async updateNote(userId: string, id: string, noteId: string, dto: UpdateSkillNoteDto) {
    await this.requireSkill(userId, id);
    const note = await this.prisma.skillNote.findFirst({ where: { id: noteId, skillId: id } });
    if (!note) throw new NotFoundException('Note not found');
    const text = dto.text !== undefined ? cleanLongText(dto.text, 'note', SKILL_LIMITS.noteText) : note.text;
    if (!text) throw new BadRequestException('Write the note first');
    const title = noteTitle(dto.title !== undefined ? cleanOptionalText(dto.title, 'title', SKILL_LIMITS.noteTitle) : note.title, text);
    const date = dto.date !== undefined ? asDate(pastDay(dto.date, dhakaDateKey(new Date()))) : note.date;
    return toNote(await this.prisma.skillNote.update({ where: { id: noteId }, data: { title, text, date } }));
  }

  async removeNote(userId: string, id: string, noteId: string): Promise<{ id: string }> {
    await this.requireSkill(userId, id);
    const { count } = await this.prisma.skillNote.deleteMany({ where: { id: noteId, skillId: id } });
    if (count === 0) throw new NotFoundException('Note not found');
    return { id: noteId };
  }

  // --- Resources ---

  async addResource(userId: string, id: string, dto: CreateSkillResourceDto) {
    await this.requireSkill(userId, id);
    const title = cleanRequiredText(dto.title, 'title', SKILL_LIMITS.resourceTitle);
    const url = cleanLink(dto.url ?? '');
    const resource = await createWithinCap(
      this.prisma,
      id,
      'skill-resources',
      SKILL_LIMITS.resources,
      `A skill can keep up to ${SKILL_LIMITS.resources} resources`,
      (tx) => tx.skillResource.count({ where: { skillId: id } }),
      (tx) => tx.skillResource.create({ data: { skillId: id, kind: dto.kind, title, url } }),
    );
    return toResource(resource);
  }

  async updateResource(userId: string, id: string, resourceId: string, dto: UpdateSkillResourceDto) {
    await this.requireSkill(userId, id);
    const resource = await this.prisma.skillResource.findFirst({ where: { id: resourceId, skillId: id } });
    if (!resource) throw new NotFoundException('Resource not found');
    const saved = await this.prisma.skillResource.update({
      where: { id: resourceId },
      data: {
        kind: dto.kind ?? resource.kind,
        title: dto.title !== undefined ? cleanRequiredText(dto.title, 'title', SKILL_LIMITS.resourceTitle) : resource.title,
        url: dto.url !== undefined ? cleanLink(dto.url) : resource.url,
      },
    });
    return toResource(saved);
  }

  async removeResource(userId: string, id: string, resourceId: string): Promise<{ id: string }> {
    await this.requireSkill(userId, id);
    const { count } = await this.prisma.skillResource.deleteMany({ where: { id: resourceId, skillId: id } });
    if (count === 0) throw new NotFoundException('Resource not found');
    return { id: resourceId };
  }

  setGoal(userId: string, dto: SetYearlyGoalDto): Promise<YearlyGoal> {
    return setYearlyGoal(dto.target, (year) =>
      this.prisma.skillGoal.upsert({ where: { userId_year: { userId, year } }, update: { target: dto.target }, create: { userId, year, target: dto.target } }),
    );
  }

  clearGoal(userId: string): Promise<YearlyGoal> {
    return clearYearlyGoal((year) => this.prisma.skillGoal.deleteMany({ where: { userId, year } }));
  }

  // One name is one skill (whatever its case), among those not deleted.
  private async checkName(
    userId: string,
    name: string,
    exceptId: string | null,
    client: Prisma.TransactionClient | PrismaService = this.prisma,
  ): Promise<void> {
    const clash = await client.skill.findFirst({
      where: { userId, deletedAt: null, name: { equals: name, mode: 'insensitive' }, ...(exceptId ? { id: { not: exceptId } } : {}) },
      select: { id: true },
    });
    if (clash) throw new ConflictException('You already have a skill with this name');
  }

  private async loggedTotal(tx: Prisma.TransactionClient, skillId: string): Promise<number> {
    const { _sum } = await tx.skillLog.aggregate({ where: { skillId }, _sum: { amount: true } });
    return _sum.amount ?? 0;
  }

  // The row, locked for the rest of the transaction: two saves for one
  // skill (a day's practice and an edit) queue instead of losing one.
  private async lockSkill(tx: Prisma.TransactionClient, userId: string, id: string): Promise<Skill> {
    const rows = await tx.$queryRaw<{ id: string }[]>`SELECT "id" FROM "Skill" WHERE "id" = ${id} AND "userId" = ${userId} AND "deletedAt" IS NULL FOR UPDATE`;
    if (rows.length === 0) throw new NotFoundException('Skill not found');
    return tx.skill.findUniqueOrThrow({ where: { id } });
  }

  private async requireSkill(userId: string, id: string): Promise<Skill> {
    const skill = await this.prisma.skill.findFirst({ where: { id, userId, deletedAt: null } });
    if (!skill) throw new NotFoundException('Skill not found');
    return skill;
  }
}
