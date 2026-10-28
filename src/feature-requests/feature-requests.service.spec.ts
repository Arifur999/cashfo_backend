import 'reflect-metadata';
import { FeatureRequestsService } from './feature-requests.service.js';

type Row = Record<string, unknown>;

const setup = (status = 'UNDER_REVIEW') => {
  const idea = { id: 'idea-1', platformUserId: 'cust-asker', title: 'Dark mode', description: '', status, voteCount: 3, createdAt: new Date() };
  const prisma = {
    featureRequest: {
      findUnique: vi.fn(async () => ({ ...idea })),
      update: vi.fn(async ({ data }: { data: Row }) => Object.assign(idea, data)),
    },
    featureRequestVote: {
      findMany: vi.fn(async () => [{ platformUserId: 'cust-asker' }, { platformUserId: 'cust-voter' }, { platformUserId: 'cust-suspended' }]),
    },
    // Only the active customers come back, as the where asks.
    user: {
      findMany: vi.fn(async ({ where }: { where: Row }) =>
        where.status === 'ACTIVE' && where.role === 'USER'
          ? [
              { id: 'cust-asker', name: 'A', email: 'a@x' },
              { id: 'cust-voter', name: 'V', email: 'v@x' },
            ]
          : [],
      ),
    },
    platformUser: { findMany: vi.fn(async () => []) },
    userNotification: { createMany: vi.fn(async ({ data }: { data: Row[] }) => ({ count: data.length })) },
  };
  return { service: new FeatureRequestsService(prisma as never), prisma };
};

describe('FeatureRequestsService.updateStatus', () => {
  it('rings the bell of the asker and every voter, once per status', async () => {
    const { service, prisma } = setup();
    await service.updateStatus('idea-1', { status: 'PLANNED' });

    expect(prisma.user.findMany.mock.calls.at(-1)?.[0]).toMatchObject({
      where: { id: { in: ['cust-asker', 'cust-voter', 'cust-suspended'] }, role: 'USER', status: 'ACTIVE' },
    });
    expect(prisma.userNotification.createMany).toHaveBeenCalledWith({
      data: ['cust-asker', 'cust-voter'].map((userId) => ({
        userId,
        key: 'idea:idea-1:PLANNED',
        type: 'IDEA',
        businessId: null,
        data: { event: 'IDEA_STATUS', ideaId: 'idea-1', title: 'Dark mode', status: 'PLANNED' },
      })),
      skipDuplicates: true,
    });
  });

  it('stays quiet for a move nobody is told about, or no move at all', async () => {
    const review = setup('SUBMITTED');
    await review.service.updateStatus('idea-1', { status: 'UNDER_REVIEW' });
    expect(review.prisma.userNotification.createMany).not.toHaveBeenCalled();

    const same = setup('SHIPPED');
    await same.service.updateStatus('idea-1', { status: 'SHIPPED' });
    expect(same.prisma.userNotification.createMany).not.toHaveBeenCalled();
  });

  it('never fails the move when the bell does', async () => {
    const { service, prisma } = setup();
    prisma.userNotification.createMany.mockRejectedValueOnce(new Error('db hiccup'));
    await expect(service.updateStatus('idea-1', { status: 'SHIPPED' })).resolves.toMatchObject({ status: 'SHIPPED' });
  });
});
