import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { FeatureRequestStatus } from '@prisma/client';
import { END_USER_WHERE } from '../common/roles.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { ListFeatureRequestsQueryDto } from './dto/list-feature-requests-query.dto.js';
import { UpdateFeatureRequestDto } from './dto/update-feature-request.dto.js';

// The moves the people behind an idea hear about in their bell (Support >
// Feature requests: "People who voted hear about it when it moves to
// Planned or Shipped").
export const IDEA_TOLD_STATUSES: readonly FeatureRequestStatus[] = [FeatureRequestStatus.PLANNED, FeatureRequestStatus.SHIPPED];

@Injectable()
export class FeatureRequestsService {
  private readonly logger = new Logger(FeatureRequestsService.name);

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
    const existing = await this.getById(id);
    const updated = await this.prisma.featureRequest.update({ where: { id }, data: { status: dto.status } });
    if (existing.status !== updated.status && IDEA_TOLD_STATUSES.includes(updated.status)) {
      // A bell that fails to go out never undoes the move.
      await this.tellVoters(updated).catch((error: unknown) =>
        this.logger.warn(`Telling the voters of idea ${id} failed: ${error instanceof Error ? error.message : String(error)}`),
      );
    }
    return updated;
  }

  // A bell row for whoever asked for the idea and everyone who voted for it
  // (both columns hold User ids), active customers only. The key makes it
  // one row per person per status, however often the card is dragged back
  // and forth.
  private async tellVoters(idea: { id: string; title: string; status: FeatureRequestStatus; platformUserId: string }) {
    const votes = await this.prisma.featureRequestVote.findMany({ where: { featureRequestId: idea.id }, select: { platformUserId: true } });
    const ids = [...new Set([idea.platformUserId, ...votes.map((vote) => vote.platformUserId)])];
    const people = await this.prisma.user.findMany({ where: { id: { in: ids }, ...END_USER_WHERE, status: 'ACTIVE' }, select: { id: true } });
    if (people.length === 0) return;
    await this.prisma.userNotification.createMany({
      data: people.map((person) => ({
        userId: person.id,
        key: `idea:${idea.id}:${idea.status}`,
        type: 'IDEA' as const,
        businessId: null,
        data: { event: 'IDEA_STATUS', ideaId: idea.id, title: idea.title, status: idea.status },
      })),
      skipDuplicates: true,
    });
  }
}
