import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, TodoRepeatKind, type TodoItem, type TodoList, type TodoPriority, type TodoRepeat } from '@prisma/client';
import { dhakaDateOnly } from '../common/dhaka.js';
import { cleanText, INVISIBLE_ONLY } from '../common/text.js';
import { createWithinCap } from '../common/user-cap.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { CreateTodoItemDto } from './dto/create-todo-item.dto.js';
import { CreateTodoListDto } from './dto/create-todo-list.dto.js';
import type { TodoRepeatDto } from './dto/todo-fields.js';
import { UpdateTodoItemDto } from './dto/update-todo-item.dto.js';
import { addDays, dayKey, dayOf, repeatDays } from './todo-repeat.js';

const MAX_ITEM_TEXT_LENGTH = 200;
// A soft cap: the count and the insert are separate statements, so a burst of
// parallel requests can overshoot it slightly. It only guards against runaway
// data on one list, not against a determined client.
const MAX_ITEMS_PER_LIST = 200;
// Lists one user may keep -- about three years of daily lists. Every list
// comes back in GET /api/todos, and nothing else bounded how many a
// scripted client could create.
const MAX_LISTS_PER_USER = 1000;
// Repeating tasks one user may keep.
const MAX_REPEATS_PER_USER = 100;
// How far ahead a repeating task's copies are made, so the week ahead shows.
const REPEAT_DAYS_AHEAD = 7;

// Same shape as books.service.ts's cleanTitle()/skills.service.ts's
// cleanName(): cleanText() alone doesn't reject whitespace-only or
// invisible-Unicode-only text (NFC/trim don't strip zero-width characters).
function cleanTaskText(value: string): string {
  const text = cleanText(value, 'task', MAX_ITEM_TEXT_LENGTH);
  if (INVISIBLE_ONLY.test(text)) throw new BadRequestException('A task is required');
  return text;
}

export interface TodoRepeatRuleView {
  id: string;
  kind: TodoRepeatKind;
  weekdays: number[];
  monthDay: number | null;
}

export interface TodoItemView {
  id: string;
  text: string;
  completed: boolean;
  priority: TodoPriority;
  dueTime: string | null;
  // "YYYY-MM-DD" the task was first planned for, once it has moved.
  movedFrom: string | null;
  repeat: TodoRepeatRuleView | null;
}

export interface TodoListView {
  id: string;
  date: string; // "YYYY-MM-DD"
  items: TodoItemView[];
}

export interface TodoRepeatView extends TodoRepeatRuleView {
  text: string;
  priority: TodoPriority;
  dueTime: string | null;
  startsOn: string;
}

type ItemWithRepeat = TodoItem & { repeat: TodoRepeat | null };
type ListWithItems = TodoList & { items: ItemWithRepeat[] };

const ITEMS = { orderBy: { createdAt: 'asc' as const }, include: { repeat: true } };

const ruleOf = (repeat: TodoRepeat): TodoRepeatRuleView => ({ id: repeat.id, kind: repeat.kind, weekdays: repeat.weekdays, monthDay: repeat.monthDay });

// A rule that has ended no longer shows on its copies.
const ruleView = (repeat: TodoRepeat | null): TodoRepeatRuleView | null => (repeat && repeat.endsOn === null ? ruleOf(repeat) : null);

function toItemView(item: ItemWithRepeat): TodoItemView {
  return {
    id: item.id,
    text: item.text,
    completed: item.completed,
    priority: item.priority,
    dueTime: item.dueTime,
    movedFrom: item.movedFrom ? dayKey(item.movedFrom) : null,
    repeat: ruleView(item.repeat),
  };
}

function toListView(list: ListWithItems): TodoListView {
  return { id: list.id, date: dayKey(list.date), items: list.items.map(toItemView) };
}

function toRepeatView(repeat: TodoRepeat): TodoRepeatView {
  return { ...ruleOf(repeat), text: repeat.text, priority: repeat.priority, dueTime: repeat.dueTime, startsOn: dayKey(repeat.startsOn) };
}

// The rule's fields for a repeat setting on a task dated `day`.
const ruleFields = (dto: TodoRepeatDto, day: Date) => ({
  kind: dto.kind,
  weekdays: dto.kind === TodoRepeatKind.WEEKLY ? [...(dto.weekdays ?? [])].sort() : [],
  monthDay: dto.kind === TodoRepeatKind.MONTHLY ? day.getUTCDate() : null,
});

@Injectable()
export class TodosService {
  constructor(private readonly prisma: PrismaService) {}

  async list(userId: string): Promise<TodoListView[]> {
    await this.fillRepeats(userId);
    const lists = await this.prisma.todoList.findMany({
      where: { userId },
      include: { items: ITEMS },
      orderBy: { date: 'desc' },
    });
    return lists.map(toListView);
  }

  async get(userId: string, id: string): Promise<TodoListView> {
    return toListView(await this.requireList(userId, id));
  }

  // The repeating tasks still going, for the board's "Repeating tasks" card.
  async listRepeats(userId: string): Promise<TodoRepeatView[]> {
    const repeats = await this.prisma.todoRepeat.findMany({ where: { userId, endsOn: null }, orderBy: { createdAt: 'asc' } });
    return repeats.map(toRepeatView);
  }

  // The date is a plain "YYYY-MM-DD" with no time component -- the list has
  // no timezone of its own, it's just "the list for that calendar date". The
  // DTO already enforces the YYYY-MM-DD shape; this also rejects a
  // shape-valid but non-existent calendar date (e.g. "2024-02-30", which
  // Date silently rolls over to March 1st rather than erroring).
  async create(userId: string, dto: CreateTodoListDto): Promise<TodoListView> {
    const date = this.calendarDay(dto.date);
    const existing = await this.prisma.todoList.findUnique({ where: { userId_date: { userId, date } } });
    if (existing) {
      throw new ConflictException('A to-do list for this date already exists');
    }
    try {
      const created = await createWithinCap(
        this.prisma,
        userId,
        'todo-list',
        MAX_LISTS_PER_USER,
        `You can keep at most ${MAX_LISTS_PER_USER} to-do lists. Delete some old ones first.`,
        (tx) => tx.todoList.count({ where: { userId } }),
        (tx) => tx.todoList.create({ data: { userId, date }, include: { items: ITEMS } }),
      );
      return toListView(created);
    } catch (error) {
      // Two simultaneous identical creates (double-click, second tab) both
      // pass the existence check above; the loser hits the unique index.
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw new ConflictException('A to-do list for this date already exists');
      }
      throw error;
    }
  }

  // No lock/ticks check -- a to-do list is disposable, not a protected
  // record, so it can be deleted at any time regardless of completed tasks.
  async remove(userId: string, id: string): Promise<{ id: string }> {
    const { count } = await this.prisma.todoList.deleteMany({ where: { id, userId } });
    if (count === 0) throw new NotFoundException('To-do list not found');
    return { id };
  }

  async addItem(userId: string, listId: string, dto: CreateTodoItemDto): Promise<TodoListView> {
    const list = await this.requireList(userId, listId);
    if (list.items.length >= MAX_ITEMS_PER_LIST) {
      throw new BadRequestException(`A list can have at most ${MAX_ITEMS_PER_LIST} tasks`);
    }
    const text = cleanTaskText(dto.text);
    await this.prisma.todoItem.create({ data: { listId, text, priority: dto.priority, dueTime: dto.dueTime ?? null } });
    return this.get(userId, listId);
  }

  // One route saves everything the Edit task drawer changes: the words, the
  // tick, priority and time, the day (a move), and how the task repeats.
  async updateItem(userId: string, listId: string, itemId: string, dto: UpdateTodoItemDto): Promise<TodoListView> {
    const list = await this.requireList(userId, listId);
    const item = list.items.find((each) => each.id === itemId);
    if (!item) throw new NotFoundException('Task not found');

    const fields = {
      ...(dto.text !== undefined && { text: cleanTaskText(dto.text) }),
      ...(dto.priority !== undefined && { priority: dto.priority }),
      ...(dto.dueTime !== undefined && { dueTime: dto.dueTime }),
    };
    await this.prisma.todoItem.update({
      where: { id: itemId },
      data: { ...fields, ...(dto.completed !== undefined && { completed: dto.completed }) },
    });

    // The move comes first, so a repeat set in the same save starts on the
    // task's new day.
    const rule = item.repeat && item.repeat.endsOn === null ? item.repeat : null;
    let day = list.date;
    if (dto.date !== undefined) {
      const date = this.calendarDay(dto.date);
      if (date.getTime() !== day.getTime()) {
        await this.moveItem(userId, item, day, date);
        day = date;
      }
    }

    if (dto.repeat !== undefined) {
      await this.setRepeat(userId, { ...item, ...fields }, list.date, day, rule, dto.repeat);
    } else if (rule && day === list.date && Object.keys(fields).length > 0) {
      // Words, priority or time changed on a repeating task: its days ahead
      // follow.
      await this.prisma.todoRepeat.update({ where: { id: rule.id }, data: fields });
      await this.prisma.todoItem.updateMany({ where: { repeatId: rule.id, completed: false, list: { date: { gt: day } } }, data: fields });
    }
    return this.get(userId, listId);
  }

  async removeItem(userId: string, listId: string, itemId: string): Promise<TodoListView> {
    await this.requireItem(userId, listId, itemId);
    await this.prisma.todoItem.delete({ where: { id: itemId } });
    return this.get(userId, listId);
  }

  // An unfinished task can be pushed to tomorrow's list instead of deleted --
  // "tomorrow" is always this LIST's date + 1 day (not the real calendar
  // "today"), so pushing from an old list moves it to the day right after,
  // not to the actual next calendar day.
  async moveItemToNextDay(userId: string, listId: string, itemId: string): Promise<TodoListView> {
    const list = await this.requireList(userId, listId);
    const item = list.items.find((each) => each.id === itemId);
    if (!item) throw new NotFoundException('Task not found');
    await this.moveItem(userId, item, list.date, addDays(list.date, 1));
    return this.get(userId, listId);
  }

  // Moves a task to another day's list (made on demand). It remembers the
  // day it was first planned for, and a repeating task's copy leaves its
  // rule, since the rule has (or will make) its own copy on that day.
  private async moveItem(userId: string, item: TodoItem, from: Date, to: Date): Promise<void> {
    const targetList = await this.findOrCreateList(userId, to);
    if ((await this.prisma.todoItem.count({ where: { listId: targetList.id } })) >= MAX_ITEMS_PER_LIST) {
      throw new BadRequestException(`That day's list already has ${MAX_ITEMS_PER_LIST} tasks`);
    }
    await this.prisma.todoItem.update({
      where: { id: item.id },
      data: { listId: targetList.id, movedFrom: item.movedFrom ?? from, repeatId: null },
    });
  }

  // Starts, changes or stops a task's repeating. `since` is the day the
  // task was on when the save began, `day` the one it is on now (they differ
  // when the same save moved it). Copies already made from the earlier of
  // the two are remade, so they follow the new rule.
  private async setRepeat(userId: string, item: Pick<TodoItem, 'id' | 'text' | 'priority' | 'dueTime'>, since: Date, day: Date, rule: TodoRepeat | null, repeat: TodoRepeatDto | null): Promise<void> {
    const from = day < since ? day : since;
    if (repeat === null) {
      if (!rule) return;
      await this.prisma.todoRepeat.update({ where: { id: rule.id }, data: { endsOn: since } });
      await this.dropCopiesFrom(rule.id, addDays(from, 1), item.id);
      return;
    }
    const fields = ruleFields(repeat, day);
    if (rule) {
      await this.dropCopiesFrom(rule.id, from, item.id);
      await this.prisma.todoRepeat.update({ where: { id: rule.id }, data: { ...fields, text: item.text, priority: item.priority, dueTime: item.dueTime, filledThrough: day } });
      // A move took the task off its rule; it comes back on.
      await this.prisma.todoItem.update({ where: { id: item.id }, data: { repeatId: rule.id } });
    } else {
      const created = await createWithinCap(
        this.prisma,
        userId,
        'todo-repeat',
        MAX_REPEATS_PER_USER,
        `You can keep at most ${MAX_REPEATS_PER_USER} repeating tasks.`,
        (tx) => tx.todoRepeat.count({ where: { userId, endsOn: null } }),
        (tx) => tx.todoRepeat.create({ data: { userId, ...fields, text: item.text, priority: item.priority, dueTime: item.dueTime, startsOn: day, filledThrough: day } }),
      );
      await this.prisma.todoItem.update({ where: { id: item.id }, data: { repeatId: created.id } });
    }
    await this.fillRepeats(userId);
  }

  // Unticked copies from `day` on (not the task being edited) go, for the
  // rule to remake.
  private async dropCopiesFrom(repeatId: string, day: Date, keepId: string): Promise<void> {
    await this.prisma.todoItem.deleteMany({ where: { repeatId, completed: false, id: { not: keepId }, list: { date: { gte: day } } } });
  }

  // Makes each repeating task's copies up to a week ahead. Each day is made
  // once (filledThrough moves on), so a copy someone deleted stays deleted,
  // and a unique (rule, list) index keeps two requests from doubling a copy.
  private async fillRepeats(userId: string): Promise<void> {
    const today = dhakaDateOnly(new Date());
    const horizon = addDays(today, REPEAT_DAYS_AHEAD);
    const repeats = await this.prisma.todoRepeat.findMany({ where: { userId, endsOn: null } });
    for (const repeat of repeats) {
      const filled = repeat.filledThrough ? addDays(repeat.filledThrough, 1) : repeat.startsOn;
      const from = filled > today ? filled : today;
      if (from > horizon) continue;
      for (const day of repeatDays(repeat, from, horizon)) {
        const list = await this.findOrCreateList(userId, day);
        if ((await this.prisma.todoItem.count({ where: { listId: list.id } })) >= MAX_ITEMS_PER_LIST) continue;
        await this.prisma.todoItem.createMany({
          data: [{ listId: list.id, text: repeat.text, priority: repeat.priority, dueTime: repeat.dueTime, repeatId: repeat.id }],
          skipDuplicates: true,
        });
      }
      await this.prisma.todoRepeat.update({ where: { id: repeat.id }, data: { filledThrough: horizon } });
    }
  }

  // A shape-valid "YYYY-MM-DD" that is also a real calendar day.
  private calendarDay(key: string): Date {
    const date = dayOf(key);
    if (Number.isNaN(date.getTime()) || dayKey(date) !== key) {
      throw new BadRequestException('date must be a valid calendar date');
    }
    return date;
  }

  private async findOrCreateList(userId: string, date: Date): Promise<TodoList> {
    const existing = await this.prisma.todoList.findUnique({ where: { userId_date: { userId, date } } });
    if (existing) return existing;
    try {
      return await createWithinCap(
        this.prisma,
        userId,
        'todo-list',
        MAX_LISTS_PER_USER,
        `You can keep at most ${MAX_LISTS_PER_USER} to-do lists. Delete some old ones first.`,
        (tx) => tx.todoList.count({ where: { userId } }),
        (tx) => tx.todoList.create({ data: { userId, date } }),
      );
    } catch (error) {
      // Lost a race against another request creating the same date's list.
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        return this.prisma.todoList.findUniqueOrThrow({ where: { userId_date: { userId, date } } });
      }
      throw error;
    }
  }

  private async requireList(userId: string, id: string): Promise<ListWithItems> {
    const list = await this.prisma.todoList.findUnique({ where: { id }, include: { items: ITEMS } });
    if (!list || list.userId !== userId) {
      throw new NotFoundException('To-do list not found');
    }
    return list;
  }

  private async requireItem(userId: string, listId: string, itemId: string): Promise<TodoItem> {
    const list = await this.requireList(userId, listId);
    const item = list.items.find((each) => each.id === itemId);
    if (!item) throw new NotFoundException('Task not found');
    return item;
  }
}
