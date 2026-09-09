import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { ListFeatureRequestsQueryDto } from './dto/list-feature-requests-query.dto.js';
import { UpdateFeatureRequestDto } from './dto/update-feature-request.dto.js';

@Injectable()
export class FeatureRequestsService {
  constructor(private readonly prisma: PrismaService) {}

  list(query: ListFeatureRequestsQueryDto) {
    return this.prisma.featureRequest.findMany({
      where: query.status ? { status: query.status } : undefined,
      orderBy: { voteCount: 'desc' },
    });
  }

  async getById(id: string) {
    const request = await this.prisma.featureRequest.findUnique({ where: { id } });
    if (!request) {
      throw new NotFoundException('Feature request not found');
    }
    return request;
  }

  async updateStatus(id: string, dto: UpdateFeatureRequestDto) {
    await this.getById(id);
    return this.prisma.featureRequest.update({ where: { id }, data: { status: dto.status } });
  }
}
