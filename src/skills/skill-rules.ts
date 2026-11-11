// The pure rules behind the v16 Skills pages: a link as typed, a note's
// title, the progress a skill shows, a move between shelves, a day's
// practice and the longest run of practice. Tested on their own.

import { BadRequestException } from '@nestjs/common';
import { SkillStatus, SkillUnit } from '@prisma/client';
import { SKILL_LIMITS } from './skill-options.js';

// "udemy.com/course" -> "https://udemy.com/course"; '' stays ''. Only a web
// address with a dotted host is taken.
export function cleanLink(raw: string): string {
  const text = raw.trim();
  if (!text) return '';
  const link = /^https?:\/\//i.test(text) ? text : `https://${text}`;
  if (!/^https?:\/\/[^\s/.]+(\.[^\s/.]+)*\.[a-z]{2,}(\/\S*)?$/i.test(link) || link.length > SKILL_LIMITS.link) {
    throw new BadRequestException('Write a full link, like https://udemy.com');
  }
  return link;
}

// A note without a title is titled by its first line, cut at a word near 48.
export function noteTitle(title: string, text: string): string {
  const own = title.trim();
  if (own) return own;
  const first = text.trim().split('\n')[0].trim();
  return first.length > 48 ? `${first.slice(0, 46).replace(/\s+\S*$/, '')}…` : first;
}

// The largest a target or "already done" may be, in the skill's stored unit.
export const maxCount = (unit: SkillUnit): number => (unit === SkillUnit.HOURS ? SKILL_LIMITS.minutes : SKILL_LIMITS.count);

export function checkTarget(unit: SkillUnit, target: number): void {
  if (target > maxCount(unit)) {
    throw new BadRequestException(
      unit === SkillUnit.HOURS ? `A goal can be up to ${SKILL_LIMITS.count} hours` : `A skill can have up to ${SKILL_LIMITS.count} lessons or chapters`,
    );
  }
}

// What a skill shows done: everything once completed, else what was done
// before plus every day logged, never past the target.
export const progressOf = (status: SkillStatus, target: number, base: number, logged: number): number =>
  status === SkillStatus.COMPLETED ? target : Math.min(target, base + logged);

export interface ShelfState {
  status: SkillStatus;
  pausedAt: Date | null;
  startedAt: Date | null;
  completedAt: Date | null;
}

// A move to another shelf, or a pause: the dates follow. Learning (again)
// starts the clock if it never ran and leaves "completed"; completing
// stamps the day; back to "want to learn" keeps the history.
export function moveShelf(current: ShelfState, change: { status?: SkillStatus; paused?: boolean }, now: Date): ShelfState {
  let { status, pausedAt, startedAt, completedAt } = current;
  if (change.status !== undefined && change.status !== current.status) {
    status = change.status;
    pausedAt = null;
    if (status === SkillStatus.LEARNING) {
      startedAt ??= now;
      completedAt = null;
    } else if (status === SkillStatus.COMPLETED) {
      startedAt ??= now;
      completedAt = now;
    } else {
      completedAt = null;
    }
  }
  if (change.paused !== undefined) {
    if (change.paused && status !== SkillStatus.LEARNING) throw new BadRequestException('Only a skill being learned can be paused');
    pausedAt = change.paused ? (current.status === status ? (current.pausedAt ?? now) : now) : null;
  }
  return { status, pausedAt, startedAt, completedAt };
}

// How much a day's practice may be: a day has 1440 minutes; a lessons or
// chapters skill can't go past its total (`others` is what is done without
// this day).
export function checkPractice(unit: SkillUnit, amount: number, target: number, others: number): void {
  if (unit === SkillUnit.HOURS) {
    if (amount > SKILL_LIMITS.minutesPerDay) throw new BadRequestException('A day has only 1440 minutes');
    return;
  }
  const left = Math.max(0, target - others);
  const word = unit === SkillUnit.CHAPTERS ? 'chapters' : 'lessons';
  if (left === 0) throw new BadRequestException(`All ${word} are already done. Mark the skill completed instead`);
  if (amount > left) throw new BadRequestException(`Only ${left} ${word} are left in this skill`);
}

const shift = (day: string, by: number): string => new Date(Date.parse(`${day}T00:00:00.000Z`) + by * 86_400_000).toISOString().slice(0, 10);

// Days in a row with practice up to today (or yesterday while today has
// none yet), and the longest such run ever.
export function practiceRuns(days: readonly string[], today: string): { streak: number; best: number } {
  const has = new Set(days);
  let streak = 0;
  for (let day = has.has(today) ? today : shift(today, -1); has.has(day); day = shift(day, -1)) streak++;
  let best = 0;
  let run = 0;
  let previous: string | null = null;
  for (const day of [...has].sort()) {
    run = previous !== null && shift(previous, 1) === day ? run + 1 : 1;
    best = Math.max(best, run);
    previous = day;
  }
  return { streak, best };
}
