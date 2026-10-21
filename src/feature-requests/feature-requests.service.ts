import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { ListFeatureRequestsQueryDto } from './dto/list-feature-requests-query.dto.js';
import { UpdateFeatureRequestDto } from './dto/update-feature-request.dto.js';

@Injectable()
export class FeatureRequestsService {
  constructor(private readonly prisma: PrismaService) {}

  async list(query: ListFeatureRequestsQueryDto) {
    const requests = await this.prisma.featureRequest.findMany({
      where: query.status ? { status: query.status } : undefined,
      orderBy: { voteCount: 'desc' },
    });
    return this.withRequesters(requests);
  }

  async getById(id: string) {
    const request = await this.prisma.featureRequest.findUnique({ where: { id } });
    if (!request) {
      throw new NotFoundException('Feature request not found');
    }
    const [withRequester] = await this.withRequesters([request]);
    return withRequester;
  }

  // Who asked, so the team can follow up: a customer's account (ideas sent
  // from the app's Help page), or an older request's legacy platform user.
  // Null when neither exists any more.
  private async withRequesters<T extends { platformUserId: string }>(requests: T[]) {
    const ids = [...new Set(requests.map((request) => request.platformUserId))];
    const [users, platformUsers] = await Promise.all([
      this.prisma.user.findMany({ where: { id: { in: ids } }, select: { id: true, name: true, email: true } }),
      this.prisma.platformUser.findMany({ where: { id: { in: ids } }, select: { id: true, name: true, email: true } }),
    ]);
    const byId = new Map([...platformUsers, ...users].map((person) => [person.id, person]));
    return requests.map((request) => {
      const person = byId.get(request.platformUserId);
      return { ...request, requester: person ? { id: person.id, name: person.name, email: person.email, isCustomer: users.some((user) => user.id === person.id) } : null };
    });
  }

  async updateStatus(id: string, dto: UpdateFeatureRequestDto) {
    await this.getById(id);
    return this.prisma.featureRequest.update({ where: { id }, data: { status: dto.status } });
  }
}
