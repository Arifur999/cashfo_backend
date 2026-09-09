import { Injectable, NotFoundException } from '@nestjs/common';
import { CategoryDirection } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service.js';
import { CreateCategoryDto } from './dto/create-category.dto.js';
import { UpdateCategoryDto } from './dto/update-category.dto.js';

@Injectable()
export class CategoriesService {
  constructor(private readonly prisma: PrismaService) {}

  list(type?: CategoryDirection) {
    return this.prisma.defaultCategory.findMany({
      where: type ? { type } : undefined,
      orderBy: [{ type: 'asc' }, { displayOrder: 'asc' }],
      include: { linkedAccountTemplate: { select: { id: true, name: true, nameBn: true } } },
    });
  }

  create(dto: CreateCategoryDto) {
    return this.prisma.defaultCategory.create({
      data: {
        name: dto.name,
        nameBn: dto.nameBn,
        type: dto.type,
        icon: dto.icon,
        linkedAccountTemplateId: dto.linkedAccountTemplateId,
        displayOrder: dto.displayOrder ?? 0,
        isActive: dto.isActive ?? true,
      },
    });
  }

  async update(id: string, dto: UpdateCategoryDto) {
    await this.requireCategory(id);
    return this.prisma.defaultCategory.update({
      where: { id },
      data: {
        ...(dto.name !== undefined && { name: dto.name }),
        ...(dto.nameBn !== undefined && { nameBn: dto.nameBn }),
        ...(dto.type !== undefined && { type: dto.type }),
        ...(dto.icon !== undefined && { icon: dto.icon }),
        ...(dto.linkedAccountTemplateId !== undefined && { linkedAccountTemplateId: dto.linkedAccountTemplateId }),
        ...(dto.displayOrder !== undefined && { displayOrder: dto.displayOrder }),
        ...(dto.isActive !== undefined && { isActive: dto.isActive }),
      },
    });
  }

  private async requireCategory(id: string) {
    const category = await this.prisma.defaultCategory.findUnique({ where: { id } });
    if (!category) {
      throw new NotFoundException('Category not found');
    }
    return category;
  }
}
