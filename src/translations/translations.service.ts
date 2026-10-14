import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service.js';
import { CreateTranslationDto } from './dto/create-translation.dto.js';
import { ListTranslationsQueryDto } from './dto/list-translations-query.dto.js';
import { UpdateTranslationDto } from './dto/update-translation.dto.js';

export type Bundle = { [segment: string]: string | Bundle };

// Segments that name an object's built-in machinery rather than a key: a
// key like "__proto__.x" or "constructor.keys" written into a plain object
// changes Object.prototype or Object.keys for the whole API process.
export const FORBIDDEN_KEY_SEGMENTS = new Set(['__proto__', 'prototype', 'constructor']);

// "dashboard.total_income" -> ["dashboard", "dashboard.total_income"] style
// ancestors: every proper dotted prefix of a key.
function prefixesOf(key: string): string[] {
  const segments = key.split('.');
  return segments.slice(0, -1).map((_, i) => segments.slice(0, i + 1).join('.'));
}

// Turns "dashboard.total_income" -> value into { dashboard: { total_income: value } },
// merging into the given root bundle. Bundles have no prototype, forbidden
// segments are skipped, and a key that collides with another (one is a
// prefix of the other) keeps whichever was written first instead of
// throwing.
function setNested(root: Bundle, dottedKey: string, value: string) {
  const segments = dottedKey.split('.');
  if (segments.some((segment) => FORBIDDEN_KEY_SEGMENTS.has(segment))) return;
  let node = root;
  for (const [i, segment] of segments.entries()) {
    const existing = node[segment];
    if (i === segments.length - 1) {
      if (existing === undefined) node[segment] = value;
      return;
    }
    if (existing === undefined) {
      const child: Bundle = Object.create(null);
      node[segment] = child;
      node = child;
    } else if (typeof existing === 'string') {
      return;
    } else {
      node = existing;
    }
  }
}

@Injectable()
export class TranslationsService {
  constructor(private readonly prisma: PrismaService) {}

  list(query: ListTranslationsQueryDto) {
    const where: Prisma.TranslationStringWhereInput = {};
    if (query.context) where.context = query.context;
    if (query.search) {
      where.OR = [
        { key: { contains: query.search, mode: 'insensitive' } },
        { en: { contains: query.search, mode: 'insensitive' } },
        { bn: { contains: query.search, mode: 'insensitive' } },
      ];
    }
    return this.prisma.translationString.findMany({ where, orderBy: { key: 'asc' } });
  }

  async create(dto: CreateTranslationDto, adminId: string, ipAddress?: string) {
    if (dto.key.split('.').some((segment) => FORBIDDEN_KEY_SEGMENTS.has(segment))) {
      throw new BadRequestException('This key uses a reserved word (__proto__, prototype or constructor)');
    }
    const existing = await this.prisma.translationString.findUnique({ where: { key: dto.key } });
    if (existing) {
      throw new ConflictException('A translation with this key already exists');
    }
    // The export nests keys by their dots, so "dashboard" and
    // "dashboard.title" can't both exist: one would have to be text and a
    // group at once.
    const clash = await this.prisma.translationString.findFirst({
      where: { OR: [{ key: { startsWith: `${dto.key}.` } }, { key: { in: prefixesOf(dto.key) } }] },
      select: { key: true },
    });
    if (clash) {
      throw new ConflictException(`"${dto.key}" clashes with the existing key "${clash.key}" -- one can't be a group of the other`);
    }
    return this.prisma.$transaction(async (tx) => {
      const created = await tx.translationString.create({
        data: { key: dto.key, en: dto.en, bn: dto.bn, context: dto.context, updatedBy: adminId },
      });
      await tx.auditLog.create({
        data: {
          adminUserId: adminId,
          action: 'TRANSLATION_CREATED',
          entityType: 'TranslationString',
          entityId: created.id,
          newValue: { key: created.key, en: created.en, bn: created.bn },
          ipAddress,
        },
      });
      return created;
    });
  }

  async update(id: string, dto: UpdateTranslationDto, adminId: string, ipAddress?: string) {
    const existing = await this.requireTranslation(id);

    return this.prisma.$transaction(async (tx) => {
      const result = await tx.translationString.update({
        where: { id },
        data: {
          ...(dto.en !== undefined && { en: dto.en }),
          ...(dto.bn !== undefined && { bn: dto.bn }),
          ...(dto.context !== undefined && { context: dto.context }),
          updatedBy: adminId,
        },
      });

      await tx.auditLog.create({
        data: {
          adminUserId: adminId,
          action: 'TRANSLATION_UPDATED',
          entityType: 'TranslationString',
          entityId: id,
          oldValue: { en: existing.en, bn: existing.bn },
          newValue: { en: result.en, bn: result.bn },
          ipAddress,
        },
      });

      return result;
    });
  }

  async export() {
    const all = await this.prisma.translationString.findMany({ orderBy: { key: 'asc' } });
    const en: Bundle = Object.create(null);
    const bn: Bundle = Object.create(null);
    for (const row of all) {
      setNested(en, row.key, row.en);
      setNested(bn, row.key, row.bn);
    }
    return { en, bn };
  }

  private async requireTranslation(id: string) {
    const translation = await this.prisma.translationString.findUnique({ where: { id } });
    if (!translation) {
      throw new NotFoundException('Translation not found');
    }
    return translation;
  }
}
