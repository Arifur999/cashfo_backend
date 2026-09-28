import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, type TodoItem, type TodoList } from '@prisma/client';
import { cleanText, INVISIBLE_ONLY } from '../common/text.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { CreateTodoItemDto } from './dto/create-todo-item.dto.js';
import { CreateTodoListDto } from './dto/create-todo-list.dto.js';
import { UpdateTodoItemDto } from './dto/update-todo-item.dto.js';

const MAX_ITEM_TEXT_LENGTH = 200;
// A soft cap: the count and the insert are separate statements, so a burst of
// parallel requests can overshoot it slightly. It only guards against runaway
// data on one list, not against a determined client.
const MAX_ITEMS_PER_LIST = 200;

// Same shape as books.service.ts's cleanTitle()/skills.service.ts's
// cleanName(): cleanText() alone doesn't reject whitespace-only or
// invisible-Unicode-only text (NFC/trim don't strip zero-width characters).
function cleanTaskText(value: string): string {
  const text = cleanText(value, 'task', MAX_ITEM_TEXT_LENGTH);
  if (INVISIBLE_ONLY.test(text)) throw new BadRequestException('A task is required');
  return text;
}

export interface TodoItemView {
  id: string;
  text: string;
  completed: boolean;
}

export interface TodoListView {
  id: string;
  date: string; // "YYYY-MM-DD"
  items: TodoItemView[];
}

function toItemView(item: TodoItem): TodoItemView {
  return { id: item.id, text: item.text, completed: item.completed };
}

function toListView(list: TodoList & { items: TodoItem[] }): TodoListView {
  return {
    id: list.id,
    date: list.date.toISOString().slice(0, 10),
    items: list.items.map(toItemView),
  };
}

@Injectable()
export class TodosService {
  constructor(private readonly prisma: PrismaService) {}

  async list(userId: string): Promise<TodoListView[]> {
    const lists = await this.prisma.todoList.findMany({
      where: { userId },
      include: { items: { orderBy: { createdAt: 'asc' } } },
      orderBy: { date: 'desc' },
    });
    return lists.map(toListView);
  }

  async get(userId: string, id: string): Promise<TodoListView> {
    return toListView(await this.requireList(userId, id));
  }

  // The date is a plain "YYYY-MM-DD" with no time component -- the list has
  // no timezone of its own, it's just "the list for that calendar date". The
  // DTO already enforces the YYYY-MM-DD shape; this also rejects a
  // shape-valid but non-existent calendar date (e.g. "2024-02-30", which
  // Date silently rolls over to March 1st rather than erroring).
  async create(userId: string, dto: CreateTodoListDto): Promise<TodoListView> {
    const date = new Date(`${dto.date}T00:00:00.000Z`);
    if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== dto.date) {
      throw new BadRequestException('date must be a valid calendar date');
    }
    const existing = await this.prisma.todoList.findUnique({ where: { userId_date: { userId, date } } });
    if (existing) {
      throw new ConflictException('A to-do list for this date already exists');
    }
    try {
      const created = await this.prisma.todoList.create({ data: { userId, date }, include: { items: true } });
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
    await this.prisma.todoItem.create({ data: { listId, text } });
    return this.get(userId, listId);
  }

  async updateItem(userId: string, listId: string, itemId: string, dto: UpdateTodoItemDto): Promise<TodoListView> {
    await this.requireItem(userId, listId, itemId);
    await this.prisma.todoItem.update({
      where: { id: itemId },
      data: {
        ...(dto.text !== undefined && { text: cleanTaskText(dto.text) }),
        ...(dto.completed !== undefined && { completed: dto.completed }),
      },
    });
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
  // not to the actual next calendar day. Creates that list on demand, same
  // find-or-create shape as create().
  async moveItemToNextDay(userId: string, listId: string, itemId: string): Promise<TodoListView> {
    const list = await this.requireList(userId, listId);
    if (!list.items.some((item) => item.id === itemId)) {
      throw new NotFoundException('Task not found');
    }
    const nextDate = new Date(list.date);
    nextDate.setUTCDate(nextDate.getUTCDate() + 1);
    const targetList = await this.findOrCreateList(userId, nextDate);
    await this.prisma.todoItem.update({ where: { id: itemId }, data: { listId: targetList.id } });
    return this.get(userId, listId);
  }

  private async findOrCreateList(userId: string, date: Date): Promise<TodoList> {
    const existing = await this.prisma.todoList.findUnique({ where: { userId_date: { userId, date } } });
    if (existing) return existing;
    try {
      return await this.prisma.todoList.create({ data: { userId, date } });
    } catch (error) {
      // Lost a race against another request creating the same date's list.
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        return this.prisma.todoList.findUniqueOrThrow({ where: { userId_date: { userId, date } } });
      }
      throw error;
    }
  }

  private async requireList(userId: string, id: string): Promise<TodoList & { items: TodoItem[] }> {
    const list = await this.prisma.todoList.findUnique({ where: { id }, include: { items: { orderBy: { createdAt: 'asc' } } } });
    if (!list || list.userId !== userId) {
      throw new NotFoundException('To-do list not found');
    }
    return list;
  }

  private async requireItem(userId: string, listId: string, itemId: string): Promise<TodoItem> {
    await this.requireList(userId, listId);
    const item = await this.prisma.todoItem.findUnique({ where: { id: itemId } });
    if (!item || item.listId !== listId) {
      throw new NotFoundException('Task not found');
    }
    return item;
  }
}
