import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, type Note, type NoteCategory } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service.js';
import type { CreateNoteCategoryDto, CreateNoteDto, UpdateNoteCategoryDto, UpdateNoteDto } from './dto/notes.dto.js';
import { CATEGORY_COLORS, cleanTags, MAX_CATEGORIES, MAX_NOTES, STARTER_CATEGORIES } from './writing-text.js';

export type NoteView = Pick<Note, 'id' | 'kind' | 'title' | 'body' | 'categoryId' | 'tags' | 'color' | 'pinned' | 'archived' | 'createdAt' | 'updatedAt'>;
export type CategoryView = Pick<NoteCategory, 'id' | 'name' | 'color'>;

const NOTE_FIELDS = {
  id: true,
  kind: true,
  title: true,
  body: true,
  categoryId: true,
  tags: true,
  color: true,
  pinned: true,
  archived: true,
  createdAt: true,
  updatedAt: true,
} as const;
const CATEGORY_FIELDS = { id: true, name: true, color: true } as const;

const sameName = (a: string, b: string) => a.localeCompare(b, undefined, { sensitivity: 'accent' }) === 0;

// Habit Tracker > Write > Notes: quick notes and ideas, and the categories
// they share with the journal. Personal (no workspace), like the rest of
// the Habit Tracker.
@Injectable()
export class NotesService {
  constructor(private readonly prisma: PrismaService) {}

  // Every note, archived ones too: the page counts them by kind, category
  // and tag, and searches them, without asking again.
  async overview(userId: string): Promise<{ notes: NoteView[]; categories: CategoryView[] }> {
    await this.start(userId);
    const [notes, categories] = await Promise.all([
      this.prisma.note.findMany({ where: { userId }, orderBy: [{ pinned: 'desc' }, { createdAt: 'desc' }], take: MAX_NOTES, select: NOTE_FIELDS }),
      this.categories(userId),
    ]);
    return { notes, categories };
  }

  categories(userId: string): Promise<CategoryView[]> {
    return this.prisma.noteCategory.findMany({ where: { userId }, orderBy: { createdAt: 'asc' }, select: CATEGORY_FIELDS });
  }

  async create(userId: string, dto: CreateNoteDto): Promise<NoteView> {
    await this.requireCategory(userId, dto.categoryId);
    if ((await this.prisma.note.count({ where: { userId } })) >= MAX_NOTES) {
      throw new BadRequestException(`You have ${MAX_NOTES.toLocaleString('en-US')} notes, the most there can be. Delete some old ones first.`);
    }
    return this.prisma.note.create({
      data: {
        userId,
        kind: dto.kind ?? 'NOTE',
        title: dto.title ?? '',
        body: dto.body,
        categoryId: dto.categoryId ?? null,
        tags: cleanTags(dto.tags ?? []),
        color: dto.color ?? 'white',
        pinned: dto.pinned ?? false,
      },
      select: NOTE_FIELDS,
    });
  }

  async update(userId: string, id: string, dto: UpdateNoteDto): Promise<NoteView> {
    await this.requireNote(userId, id);
    await this.requireCategory(userId, dto.categoryId);
    return this.prisma.note.update({
      where: { id },
      data: {
        kind: dto.kind,
        title: dto.title,
        body: dto.body,
        categoryId: dto.categoryId,
        tags: dto.tags === undefined ? undefined : cleanTags(dto.tags),
        color: dto.color,
        pinned: dto.pinned,
        archived: dto.archived,
      },
      select: NOTE_FIELDS,
    });
  }

  async remove(userId: string, id: string): Promise<{ success: true }> {
    const { count } = await this.prisma.note.deleteMany({ where: { id, userId } });
    if (count === 0) throw new NotFoundException('Note not found');
    return { success: true };
  }

  // One person's category changes wait for each other, so two at once can't
  // both pass the name and count checks.
  async createCategory(userId: string, dto: CreateNoteCategoryDto): Promise<CategoryView> {
    await this.start(userId);
    return this.prisma.$transaction(async (tx) => {
      await this.lockCategories(tx, userId);
      const existing = await tx.noteCategory.findMany({ where: { userId }, select: CATEGORY_FIELDS });
      if (existing.length >= MAX_CATEGORIES) throw new BadRequestException(`You can have up to ${MAX_CATEGORIES} categories`);
      if (existing.some((category) => sameName(category.name, dto.name))) throw new ConflictException('You already have a category with this name.');
      const color = dto.color ?? CATEGORY_COLORS[existing.length % CATEGORY_COLORS.length];
      return tx.noteCategory.create({ data: { userId, name: dto.name, color }, select: CATEGORY_FIELDS });
    });
  }

  async updateCategory(userId: string, id: string, dto: UpdateNoteCategoryDto): Promise<CategoryView> {
    return this.prisma.$transaction(async (tx) => {
      await this.lockCategories(tx, userId);
      const existing = await tx.noteCategory.findMany({ where: { userId }, select: CATEGORY_FIELDS });
      if (!existing.some((category) => category.id === id)) throw new NotFoundException('Category not found');
      const { name } = dto;
      if (name !== undefined && existing.some((category) => category.id !== id && sameName(category.name, name))) {
        throw new ConflictException('You already have a category with this name.');
      }
      return tx.noteCategory.update({ where: { id }, data: { name, color: dto.color }, select: CATEGORY_FIELDS });
    });
  }

  private async lockCategories(tx: Prisma.TransactionClient, userId: string): Promise<void> {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`note-categories:${userId}`}))`;
  }

  // Its notes and journal entries stay, without a category (onDelete: SetNull).
  async removeCategory(userId: string, id: string): Promise<{ success: true }> {
    const { count } = await this.prisma.noteCategory.deleteMany({ where: { id, userId } });
    if (count === 0) throw new NotFoundException('Category not found');
    return { success: true };
  }

  // A category named on a note or an entry must be this person's own.
  async requireCategory(userId: string, categoryId: string | null | undefined): Promise<void> {
    if (!categoryId) return;
    const found = await this.prisma.noteCategory.findFirst({ where: { id: categoryId, userId }, select: { id: true } });
    if (!found) throw new NotFoundException('Category not found');
  }

  // The first visit adds the starter categories, once: the settings row
  // records it, so deleting them all never brings them back. Two first
  // visits at once: the loser's insert hits the unique userId and changes
  // nothing.
  async start(userId: string): Promise<void> {
    if (await this.prisma.writingSettings.findUnique({ where: { userId }, select: { id: true } })) return;
    const user = await this.prisma.user.findUnique({ where: { id: userId }, select: { preferredLanguage: true } });
    const bangla = user?.preferredLanguage === 'BN';
    try {
      await this.prisma.$transaction([
        this.prisma.writingSettings.create({ data: { userId } }),
        this.prisma.noteCategory.createMany({
          data: STARTER_CATEGORIES.map((category) => ({ userId, name: bangla ? category.bn : category.en, color: category.color })),
        }),
      ]);
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') return;
      throw error;
    }
  }

  private async requireNote(userId: string, id: string): Promise<void> {
    const found = await this.prisma.note.findFirst({ where: { id, userId }, select: { id: true } });
    if (!found) throw new NotFoundException('Note not found');
  }
}
