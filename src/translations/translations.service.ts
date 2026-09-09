import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service.js';
import { CreateTranslationDto } from './dto/create-translation.dto.js';
import { ListTranslationsQueryDto } from './dto/list-translations-query.dto.js';
import { UpdateTranslationDto } from './dto/update-translation.dto.js';

// Turns "dashboard.total_income" -> value into { dashboard: { total_income: value } },
// merging into the given root object.
function setNested(root: Record<string, unknown>, dottedKey: string, value: string) {
  const segments = dottedKey.split('.');
  let node = root;
  segments.forEach((segment, i) => {
    if (i === segments.length - 1) {
      node[segment] = value;
    } else {
      node[segment] = (node[segment] as Record<string, unknown>) ?? {};
      node = node[segment] as Record<string, unknown>;
    }
  });
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

  async create(dto: CreateTranslationDto) {
    const existing = await this.prisma.translationString.findUnique({ where: { key: dto.key } });
    if (existing) {
      throw new ConflictException('A translation with this key already exists');
    }
    return this.prisma.translationString.create({
      data: { key: dto.key, en: dto.en, bn: dto.bn, context: dto.context },
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
    const all = await this.prisma.translationString.findMany();
    const en: Record<string, unknown> = {};
    const bn: Record<string, unknown> = {};
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
