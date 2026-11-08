import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, TodoRepeatKind, type TodoCategory, type TodoItem, type TodoList, type TodoPriority, type TodoRepeat } from '@prisma/client';
import { dhakaDateOnly } from '../common/dhaka.js';
import { cleanText, INVISIBLE_ONLY } from '../common/text.js';
import { createWithinCap } from '../common/user-cap.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { CreateTaskDto } from './dto/create-task.dto.js';
import { CreateTodoCategoryDto } from './dto/create-todo-category.dto.js';
import { CreateTodoItemDto } from './dto/create-todo-item.dto.js';
import { CreateTodoListDto } from './dto/create-todo-list.dto.js';
import { MoveTodoItemsDto } from './dto/move-todo-items.dto.js';
import { MAX_CATEGORY_NAME, type TodoRepeatDto } from './dto/todo-fields.js';
import { UpdateTodoItemDto } from './dto/update-todo-item.dto.js';
import { addDays, dayKey, dayOf, repeatDays } from './todo-repeat.js';
import { cleanNote, cleanSteps, stepsOf, type TodoStepView, unticked } from './todo-text.js';

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
// Lists (categories) one user may add beside the four built-in ones.
const MAX_OWN_CATEGORIES = 30;
// How far ahead a repeating task's copies are made, so the week ahead shows.
const REPEAT_DAYS_AHEAD = 7;

// The board's four lists, made for each person the first time their lists
// are read. The app shows each one's name in the reader's language.
export const BUILT_IN_CATEGORIES = [
  { key: 'personal', name: 'Personal', color: 'blue' },
  { key: 'work', name: 'Work', color: 'violet' },
  { key: 'home', name: 'Home', color: 'orange' },
  { key: 'deen', name: 'Deen', color: 'green' },
] as const;

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
  // When it was ticked off (ISO); null while open.
  completedAt: string | null;
  priority: TodoPriority;
  dueTime: string | null;
  // Minutes before dueTime it reminds (0 = at the time); null = no reminder.
  remindBefore: number | null;
  // "YYYY-MM-DD" the task was first planned for, once it was put off.
  movedFrom: string | null;
  // How many times it was put off to a later day.
  moveCount: number;
  // The list it is filed under; null = Personal.
  categoryId: string | null;
  note: string;
  steps: TodoStepView[];
  repeat: TodoRepeatRuleView | null;
}

export interface TodoListView {
  id: string;
  // "YYYY-MM-DD", or null on the Someday list.
  date: string | null;
  items: TodoItemView[];
}

export interface TodoRepeatView extends TodoRepeatRuleView {
  text: string;
  priority: TodoPriority;
  dueTime: string | null;
  remindBefore: number | null;
  categoryId: string | null;
  startsOn: string;
}

export interface TodoCategoryView {
  id: string;
  // personal, work, home or deen on a built-in list; null on one the person added.
  key: string | null;
  name: string;
  color: string;
}

export interface MoveTodoItemsResult {
  moved: number;
  // Copies of a repeating task left where they were: their rule already has a
  // copy on that day.
  skipped: number;
}

type ItemWithRepeat = TodoItem & { repeat: TodoRepeat | null };
type ListWithItems = TodoList & { items: ItemWithRepeat[] };

const ITEMS = { orderBy: { createdAt: 'asc' as const }, include: { repeat: true } };

const ruleOf = (repeat: TodoRepeat): TodoRepeatRuleView => ({ id: repeat.id, kind: repeat.kind, weekdays: repeat.weekdays, monthDay: repeat.monthDay });

// A rule that has ended no longer shows on its copies.
const ruleView = (repeat: TodoRepeat | null): TodoRepeatRuleView | null => (repeat && repeat.endsOn === null ? ruleOf(repeat) : null);

const keyOrNull = (day: Date | null): string | null => (day ? dayKey(day) : null);

function toItemView(item: ItemWithRepeat): TodoItemView {
  return {
    id: item.id,
    text: item.text,
    completed: item.completed,
    completedAt: item.completedAt ? item.completedAt.toISOString() : null,
    priority: item.priority,
    dueTime: item.dueTime,
    remindBefore: item.remindBefore,
    movedFrom: keyOrNull(item.movedFrom),
    moveCount: item.moveCount,
    categoryId: item.categoryId,
    note: item.note,
    steps: stepsOf(item.steps),
    repeat: ruleView(item.repeat),
  };
}

function toListView(list: ListWithItems): TodoListView {
  return { id: list.id, date: keyOrNull(list.date), items: list.items.map(toItemView) };
}

function toRepeatView(repeat: TodoRepeat): TodoRepeatView {
  return {
    ...ruleOf(repeat),
    text: repeat.text,
    priority: repeat.priority,
    dueTime: repeat.dueTime,
    remindBefore: repeat.remindBefore,
    categoryId: repeat.categoryId,
    startsOn: dayKey(repeat.startsOn),
  };
}

const toCategoryView = (category: TodoCategory): TodoCategoryView => ({ id: category.id, key: category.key, name: category.name, color: category.color });

// The rule's fields for a repeat setting on a task dated `day`.
const ruleFields = (dto: TodoRepeatDto, day: Date) => ({
  kind: dto.kind,
  weekdays: dto.kind === TodoRepeatKind.WEEKLY ? [...(dto.weekdays ?? [])].sort() : [],
  monthDay: dto.kind === TodoRepeatKind.MONTHLY ? day.getUTCDate() : null,
});

const sameDay = (a: Date | null, b: Date | null): boolean => (a === null || b === null ? a === b : a.getTime() === b.getTime());

// What a task carries over to its repeating rule and the rule's copies.
type CopiedFields = Partial<Pick<TodoItem, 'text' | 'priority' | 'dueTime' | 'remindBefore' | 'categoryId' | 'note'>> & { steps?: TodoStepView[] };

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

  // The lists a task can be filed under: the four built-in ones first (made
  // here the first time), then the person's own in the order they added them.
  async listCategories(userId: string): Promise<TodoCategoryView[]> {
    await this.prisma.todoCategory.createMany({ data: BUILT_IN_CATEGORIES.map((category) => ({ userId, ...category })), skipDuplicates: true });
    const categories = await this.prisma.todoCategory.findMany({ where: { userId }, orderBy: { createdAt: 'asc' } });
    const builtIn = BUILT_IN_CATEGORIES.map((each) => categories.find((category) => category.key === each.key)).filter((category) => category !== undefined);
    return [...builtIn, ...categories.filter((category) => category.key === null)].map(toCategoryView);
  }

  async createCategory(userId: string, dto: CreateTodoCategoryDto): Promise<TodoCategoryView> {
    const name = cleanText(dto.name, 'list name', MAX_CATEGORY_NAME);
    if (INVISIBLE_ONLY.test(name)) throw new BadRequestException('Write a name for the list.');
    const created = await createWithinCap(
      this.prisma,
      userId,
      'todo-category',
      MAX_OWN_CATEGORIES,
      `You can add at most ${MAX_OWN_CATEGORIES} lists.`,
      (tx) => tx.todoCategory.count({ where: { userId, key: null } }),
      async (tx) => {
        // Checked under the lock, so two quick adds can't both pass it.
        const taken = await tx.todoCategory.findMany({ where: { userId }, select: { name: true } });
        const lower = name.toLocaleLowerCase();
        if (taken.some((each) => each.name.toLocaleLowerCase() === lower) || BUILT_IN_CATEGORIES.some((each) => each.name.toLowerCase() === lower)) {
          throw new ConflictException('A list with this name already exists.');
        }
        return tx.todoCategory.create({ data: { userId, name, color: dto.color } });
      },
    );
    return toCategoryView(created);
  }

  // Only a list the person added goes; its tasks and repeats are filed back
  // under Personal (the foreign key sets them to null).
  async removeCategory(userId: string, id: string): Promise<{ id: string }> {
    const category = await this.prisma.todoCategory.findFirst({ where: { id, userId } });
    if (!category) throw new NotFoundException('List not found');
    if (category.key !== null) throw new BadRequestException("A built-in list can't be deleted");
    await this.prisma.todoCategory.delete({ where: { id } });
    return { id };
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
    await this.prisma.todoItem.create({ data: { listId, ...(await this.newItemFields(userId, dto)) } });
    return this.get(userId, listId);
  }

  // A task added straight to a day, or to Someday, its list made on the
  // way; or a task just deleted, put back as it was (the board's Undo).
  async createTask(userId: string, dto: CreateTaskDto): Promise<TodoListView> {
    const day = dto.date === null ? null : this.calendarDay(dto.date);
    if (!day && (dto.repeat || dto.repeatId)) throw new BadRequestException('Pick a date first, so the task knows when to repeat.');
    if (dto.repeat && dto.repeatId) throw new BadRequestException('A task is put back on its repeat, or given a new one, not both');
    if (dto.completedAt !== undefined && !dto.completed) throw new BadRequestException('completedAt goes with a finished task');
    const completedAt = dto.completed ? (dto.completedAt ? new Date(dto.completedAt) : new Date()) : null;
    if (completedAt && completedAt.getTime() > Date.now()) throw new BadRequestException("A task can't be finished in the future");
    if (dto.repeatId) {
      const rule = await this.prisma.todoRepeat.findFirst({ where: { id: dto.repeatId, userId, endsOn: null } });
      if (!rule) throw new NotFoundException('Repeating task not found');
    }

    const list = await this.listFor(userId, day);
    if ((await this.prisma.todoItem.count({ where: { listId: list.id } })) >= MAX_ITEMS_PER_LIST) {
      throw new BadRequestException(day ? `That day's list already has ${MAX_ITEMS_PER_LIST} tasks` : `Someday already has ${MAX_ITEMS_PER_LIST} tasks`);
    }
    const fields = await this.newItemFields(userId, dto);
    const created = await this.prisma.todoItem.create({
      data: {
        listId: list.id,
        ...fields,
        completed: !!dto.completed,
        completedAt,
        movedFrom: dto.movedFrom ? this.calendarDay(dto.movedFrom) : null,
        moveCount: dto.moveCount ?? 0,
        repeatId: dto.repeatId ?? null,
      },
    });
    if (dto.repeat && day) await this.setRepeat(userId, created, day, day, null, dto.repeat);
    return this.get(userId, list.id);
  }

  // One route saves everything the task popup changes: the words, the tick,
  // priority and time, the list, note and steps, the day (a move, or to
  // Someday), and how the task repeats.
  async updateItem(userId: string, listId: string, itemId: string, dto: UpdateTodoItemDto): Promise<TodoListView> {
    const list = await this.requireList(userId, listId);
    const item = list.items.find((each) => each.id === itemId);
    if (!item) throw new NotFoundException('Task not found');
    if (dto.categoryId) await this.requireCategory(userId, dto.categoryId);
    // Where the task ends up, checked before anything is written.
    const since = list.date;
    const target = dto.date === undefined ? since : dto.date === null ? null : this.calendarDay(dto.date);
    if (dto.repeat && !target) throw new BadRequestException('Pick a date first, so the task knows when to repeat.');

    const fields: CopiedFields = {
      ...(dto.text !== undefined && { text: cleanTaskText(dto.text) }),
      ...(dto.priority !== undefined && { priority: dto.priority }),
      ...(dto.dueTime !== undefined && { dueTime: dto.dueTime }),
      ...(dto.remindBefore !== undefined && { remindBefore: dto.remindBefore }),
      ...(dto.categoryId !== undefined && { categoryId: dto.categoryId }),
      ...(dto.note !== undefined && { note: cleanNote(dto.note) }),
      ...(dto.steps !== undefined && { steps: cleanSteps(dto.steps) }),
    };
    const ticked =
      dto.completed !== undefined && dto.completed !== item.completed ? { completed: dto.completed, completedAt: dto.completed ? new Date() : null } : {};
    await this.prisma.todoItem.update({ where: { id: itemId }, data: { ...fields, ...ticked } });

    // The move comes first, so a repeat set in the same save starts on the
    // task's new day.
    const rule = item.repeat && item.repeat.endsOn === null ? item.repeat : null;
    let day = since;
    if (!sameDay(target, since)) {
      await this.moveItem(userId, item, since, target);
      day = target;
    }

    // An Undo of a move puts these back as they were.
    if (dto.movedFrom !== undefined || dto.moveCount !== undefined) {
      await this.prisma.todoItem.update({
        where: { id: itemId },
        data: {
          ...(dto.movedFrom !== undefined && { movedFrom: dto.movedFrom === null ? null : this.calendarDay(dto.movedFrom) }),
          ...(dto.moveCount !== undefined && { moveCount: dto.moveCount }),
        },
      });
    }

    if (dto.repeat !== undefined) {
      await this.setRepeat(userId, { ...item, ...fields, steps: fields.steps ?? stepsOf(item.steps) }, since, day, rule, dto.repeat);
    } else if (rule && day === since && Object.keys(fields).length > 0) {
      // Words, priority, time, reminder, list, note or steps changed on a
      // repeating task: its days ahead follow (their steps unticked).
      const copied = { ...fields, ...(fields.steps && { steps: unticked(fields.steps) }) };
      await this.prisma.todoRepeat.update({ where: { id: rule.id }, data: copied });
      if (since) await this.prisma.todoItem.updateMany({ where: { repeatId: rule.id, completed: false, list: { date: { gt: since } } }, data: copied });
    }
    return this.get(userId, listId);
  }

  // updateItem() for a task found by its id alone; answers with the list it
  // was on.
  async updateTask(userId: string, itemId: string, dto: UpdateTodoItemDto): Promise<TodoListView> {
    const item = await this.prisma.todoItem.findFirst({ where: { id: itemId, list: { userId } }, select: { listId: true } });
    if (!item) throw new NotFoundException('Task not found');
    return this.updateItem(userId, item.listId, itemId, dto);
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
    if (!list.date) throw new BadRequestException('A Someday task has no day to move on from');
    await this.moveItem(userId, item, list.date, addDays(list.date, 1));
    return this.get(userId, listId);
  }

  // Several tasks to one day, or to Someday (the board's "Move all to
  // today"). A copy of a repeating task whose rule already has a copy on
  // that day stays where it is: moving it would list the task twice.
  async moveItems(userId: string, dto: MoveTodoItemsDto): Promise<MoveTodoItemsResult> {
    const to = dto.date === null ? null : this.calendarDay(dto.date);
    const items = await this.prisma.todoItem.findMany({ where: { id: { in: dto.itemIds }, list: { userId } }, include: { list: true } });
    if (items.length !== dto.itemIds.length) throw new NotFoundException('Task not found');
    const target = await this.listFor(userId, to);
    const already = await this.prisma.todoItem.findMany({ where: { listId: target.id }, select: { repeatId: true } });
    const rulesThere = new Set(already.flatMap((each) => (each.repeatId ? [each.repeatId] : [])));
    const moving = items.filter((item) => item.listId !== target.id && !(item.repeatId && rulesThere.has(item.repeatId)));
    if (already.length + moving.length > MAX_ITEMS_PER_LIST) {
      throw new BadRequestException(
        to ? `That day's list can hold at most ${MAX_ITEMS_PER_LIST} tasks` : `Someday can hold at most ${MAX_ITEMS_PER_LIST} tasks`,
      );
    }
    await this.prisma.$transaction(
      moving.map((item) => this.prisma.todoItem.update({ where: { id: item.id }, data: this.moveData(item, item.list.date, target.id, to) })),
    );
    return { moved: moving.length, skipped: items.filter((item) => item.listId !== target.id).length - moving.length };
  }

  // The fields a new task starts with, cleaned and checked.
  private async newItemFields(userId: string, dto: CreateTodoItemDto) {
    if (dto.categoryId) await this.requireCategory(userId, dto.categoryId);
    return {
      text: cleanTaskText(dto.text),
      priority: dto.priority,
      dueTime: dto.dueTime ?? null,
      remindBefore: dto.remindBefore ?? null,
      categoryId: dto.categoryId ?? null,
      note: dto.note === undefined ? '' : cleanNote(dto.note),
      steps: dto.steps === undefined ? [] : cleanSteps(dto.steps),
    };
  }

  // Moves a task to another day's list or to Someday (made on demand). Put
  // off to a later day, it counts the move and remembers the day it was first
  // planned for. A repeating task's copy leaves its rule, since the rule has
  // (or will make) its own copy on that day -- and when it already has one
  // there, the move is refused rather than listing the task twice.
  private async moveItem(userId: string, item: TodoItem, from: Date | null, to: Date | null): Promise<void> {
    const targetList = await this.listFor(userId, to);
    if (item.repeatId && (await this.prisma.todoItem.count({ where: { listId: targetList.id, repeatId: item.repeatId } })) > 0) {
      throw new ConflictException('This repeating task is already on that day');
    }
    if ((await this.prisma.todoItem.count({ where: { listId: targetList.id } })) >= MAX_ITEMS_PER_LIST) {
      throw new BadRequestException(to ? `That day's list already has ${MAX_ITEMS_PER_LIST} tasks` : `Someday already has ${MAX_ITEMS_PER_LIST} tasks`);
    }
    await this.prisma.todoItem.update({ where: { id: item.id }, data: this.moveData(item, from, targetList.id, to) });
  }

  private moveData(item: TodoItem, from: Date | null, listId: string, to: Date | null): Prisma.TodoItemUncheckedUpdateInput {
    const putOff = from !== null && to !== null && to > from;
    return { listId, repeatId: null, ...(putOff && { movedFrom: item.movedFrom ?? from, moveCount: { increment: 1 } }) };
  }

  // Starts, changes or stops a task's repeating. `since` is the day the
  // task was on when the save began, `day` the one it is on now (they differ
  // when the same save moved it). Copies already made from the earlier of
  // the two are remade, so they follow the new rule.
  private async setRepeat(
    userId: string,
    item: Pick<TodoItem, 'id' | 'text' | 'priority' | 'dueTime' | 'remindBefore' | 'categoryId' | 'note'> & { steps: Prisma.JsonValue | TodoStepView[] },
    since: Date | null,
    day: Date | null,
    rule: TodoRepeat | null,
    repeat: TodoRepeatDto | null,
  ): Promise<void> {
    const dated = [since, day].filter((each): each is Date => each !== null);
    const from = dated.length > 0 ? dated.reduce((a, b) => (a < b ? a : b)) : dhakaDateOnly(new Date());
    if (repeat === null) {
      if (!rule) return;
      await this.prisma.todoRepeat.update({ where: { id: rule.id }, data: { endsOn: since ?? from } });
      await this.dropCopiesFrom(rule.id, addDays(from, 1), item.id);
      return;
    }
    if (!day) throw new BadRequestException('Pick a date first, so the task knows when to repeat.');
    const fields = ruleFields(repeat, day);
    // The copies remind as the repeat says, or else as the task does.
    const remindBefore = repeat.remindBefore !== undefined ? repeat.remindBefore : item.remindBefore;
    const copied = {
      text: item.text,
      priority: item.priority,
      dueTime: item.dueTime,
      remindBefore,
      categoryId: item.categoryId,
      note: item.note,
      steps: unticked(Array.isArray(item.steps) ? stepsOf(item.steps as Prisma.JsonValue) : []),
    };
    if (rule) {
      await this.dropCopiesFrom(rule.id, from, item.id);
      await this.prisma.todoRepeat.update({ where: { id: rule.id }, data: { ...fields, ...copied, filledThrough: day } });
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
        (tx) => tx.todoRepeat.create({ data: { userId, ...fields, ...copied, startsOn: day, filledThrough: day } }),
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
        const list = await this.listFor(userId, day);
        if ((await this.prisma.todoItem.count({ where: { listId: list.id } })) >= MAX_ITEMS_PER_LIST) continue;
        await this.prisma.todoItem.createMany({
          data: [
            {
              listId: list.id,
              text: repeat.text,
              priority: repeat.priority,
              dueTime: repeat.dueTime,
              remindBefore: repeat.remindBefore,
              categoryId: repeat.categoryId,
              note: repeat.note,
              steps: unticked(stepsOf(repeat.steps)),
              repeatId: repeat.id,
            },
          ],
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

  // A day's list, or the Someday list for null; made on demand.
  private listFor(userId: string, date: Date | null): Promise<TodoList> {
    return date ? this.findOrCreateList(userId, date) : this.findOrCreateSomeday(userId);
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

  // One per person (the unique somedayOf), so it never counts against the
  // cap on day lists.
  private async findOrCreateSomeday(userId: string): Promise<TodoList> {
    const existing = await this.prisma.todoList.findUnique({ where: { somedayOf: userId } });
    if (existing) return existing;
    try {
      return await this.prisma.todoList.create({ data: { userId, date: null, somedayOf: userId } });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        return this.prisma.todoList.findUniqueOrThrow({ where: { somedayOf: userId } });
      }
      throw error;
    }
  }

  private async requireCategory(userId: string, id: string): Promise<TodoCategory> {
    const category = await this.prisma.todoCategory.findFirst({ where: { id, userId } });
    if (!category) throw new NotFoundException('List not found');
    return category;
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
