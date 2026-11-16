import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { GroupAccessService, hashToken } from './group-access.service.js';

const member = (over: Record<string, unknown> = {}) => ({
  id: 'gm-1',
  businessId: 'biz-1',
  name: 'Rakib Mahmud',
  phone: '01913-640218',
  role: 'VIEWER',
  status: 'ACTIVE',
  isOwner: false,
  userId: null as string | null,
  user: null as Record<string, unknown> | null,
  ...over,
});

const setup = (
  opts: { member?: ReturnType<typeof member>; link?: Record<string, unknown> | null; otherOwnerGroups?: number; usernameTaken?: boolean } = {},
) => {
  const theMember = opts.member ?? member();
  const prisma = {
    groupMember: {
      findFirst: vi.fn().mockResolvedValue(theMember),
      findUnique: vi.fn().mockResolvedValue(theMember),
      findMany: vi.fn().mockResolvedValue([]),
      count: vi.fn().mockResolvedValue(opts.otherOwnerGroups ?? 0),
      update: vi.fn().mockResolvedValue(theMember),
    },
    groupAccessLink: {
      upsert: vi.fn().mockImplementation(({ create }: { create: Record<string, unknown> }) => Promise.resolve(create)),
      findUnique: vi.fn().mockResolvedValue(opts.link ?? null),
      findFirst: vi.fn().mockResolvedValue(opts.link ?? null),
      findMany: vi.fn().mockResolvedValue([]),
      delete: vi.fn().mockResolvedValue({}),
      deleteMany: vi.fn().mockResolvedValue({ count: 1 }),
    },
    business: {
      findUnique: vi.fn().mockResolvedValue({ id: 'biz-1', name: 'Mirpur Family', ownerId: 'owner-1', deletedAt: null, type: 'GROUP' }),
    },
    businessMember: { upsert: vi.fn(), updateMany: vi.fn(), findUnique: vi.fn().mockResolvedValue(null) },
    user: {
      findUnique: vi
        .fn()
        .mockImplementation(({ where }: { where: { username?: string } }) =>
          Promise.resolve(where.username !== undefined ? (opts.usernameTaken ? { id: 'someone' } : null) : { name: 'Khaled Mahmud', showNameInGroups: true }),
        ),
      findUniqueOrThrow: vi.fn().mockResolvedValue({ id: 'new-user', portalOnly: false }),
      create: vi.fn().mockImplementation(({ data }: { data: Record<string, unknown> }) => Promise.resolve({ id: 'new-user', ...data })),
    },
    platformSetting: { findUnique: vi.fn().mockResolvedValue(null) },
    groupSettings: { findUnique: vi.fn().mockResolvedValue({ kind: 'FAMILY' }) },
    groupActivity: { create: vi.fn() },
    $transaction: vi.fn(),
  };
  prisma.$transaction.mockImplementation((fn: (tx: typeof prisma) => unknown) => fn(prisma));
  const credentials = { set: vi.fn() };
  const sessions = { create: vi.fn().mockResolvedValue('session-1'), revokeAllForUser: vi.fn() };
  const userAuth = { finishSignIn: vi.fn().mockResolvedValue({ accessToken: 'a', refreshToken: 'r' }) };
  const service = new GroupAccessService(prisma as never, credentials as never, sessions as never, userAuth as never);
  return { service, prisma, credentials, sessions, userAuth };
};

const waiting = (over: Record<string, unknown> = {}) => ({
  id: 'link-1',
  businessId: 'biz-1',
  groupMemberId: 'gm-1',
  kind: 'JOIN',
  tokenHash: hashToken('t'.repeat(43)),
  tokenSealed: null,
  createdByUserId: 'owner-1',
  expiresAt: new Date(Date.now() + 60_000),
  createdAt: new Date(),
  ...over,
});
const TOKEN = 't'.repeat(43);
const client = { ipAddress: '203.0.113.9', userAgent: 'UA' };

describe('GroupAccessService links', () => {
  it('gives a link only to a member whose role gives access', async () => {
    const { service } = setup({ member: member({ role: 'MEMBER' }) });
    await expect(service.createLink('biz-1', 'gm-1', 'JOIN', 'owner-1')).rejects.toThrow(BadRequestException);
  });

  it("won't make a join link for someone who can already log in", async () => {
    const { service } = setup({ member: member({ userId: 'u-1', user: { id: 'u-1', portalOnly: true } }) });
    await expect(service.createLink('biz-1', 'gm-1', 'JOIN', 'owner-1')).rejects.toThrow(/already log in/);
  });

  it("never resets a person's own Smartly account, nor a login another owner's group uses", async () => {
    const own = setup({ member: member({ userId: 'u-1', user: { id: 'u-1', portalOnly: false } }) });
    await expect(own.service.createLink('biz-1', 'gm-1', 'RESET', 'owner-1')).rejects.toThrow(/own Smartly account/);
    const shared = setup({ member: member({ userId: 'u-1', user: { id: 'u-1', portalOnly: true } }), otherOwnerGroups: 1 });
    await expect(shared.service.createLink('biz-1', 'gm-1', 'RESET', 'owner-1')).rejects.toThrow(/another admin/);
  });

  it('keeps only the token hash, for a week', async () => {
    const { service, prisma } = setup();
    const made = await service.createLink('biz-1', 'gm-1', 'JOIN', 'owner-1');
    const saved = prisma.groupAccessLink.upsert.mock.calls[0][0].create;
    expect(saved.tokenHash).toBe(hashToken(made.token));
    expect(saved).not.toHaveProperty('token');
    const days = (made.expiresAt.getTime() - made.createdAt.getTime()) / 86_400_000;
    expect(days).toBe(7);
  });

  it('answers the same for an unknown or a run-out link', async () => {
    await expect(setup().service.preview(TOKEN)).rejects.toThrow(NotFoundException);
    await expect(setup({ link: waiting({ expiresAt: new Date(Date.now() - 1) }) }).service.preview(TOKEN)).rejects.toThrow(NotFoundException);
    await expect(setup({ link: waiting(), member: member({ role: 'MEMBER' }) }).service.preview(TOKEN)).rejects.toThrow(NotFoundException);
  });
});

describe('GroupAccessService joining', () => {
  it('makes a portal login with a placeholder email and the member as a Viewer, and claims the link', async () => {
    const { service, prisma, credentials } = setup({ link: waiting() });
    const result = await service.accept(TOKEN, { username: 'rakib.m', password: 'secret123' }, client);
    const data = prisma.user.create.mock.calls[0][0].data;
    expect(data).toMatchObject({ name: 'Rakib Mahmud', username: 'rakib.m', portalOnly: true, phone: '+8801913640218' });
    expect(data.email).toMatch(/@group-member\.invalid$/);
    expect(credentials.set).toHaveBeenCalledWith('new-user', 'secret123', prisma);
    expect(prisma.groupAccessLink.delete).toHaveBeenCalledWith({ where: { tokenHash: hashToken(TOKEN) } });
    expect(prisma.businessMember.upsert).toHaveBeenCalledWith(
      expect.objectContaining({ create: expect.objectContaining({ userId: 'new-user', role: 'STAFF', status: 'ACTIVE' }) }),
    );
    expect(result).toMatchObject({ businessId: 'biz-1', accessToken: 'a' });
  });

  it('refuses a taken username', async () => {
    const { service } = setup({ link: waiting(), usernameTaken: true });
    await expect(service.accept(TOKEN, { username: 'rakib.m', password: 'secret123' }, client)).rejects.toThrow(ConflictException);
  });

  it('sets a new password from a reset link and signs the old devices out', async () => {
    const { service, credentials, sessions, prisma } = setup({
      link: waiting({ kind: 'RESET' }),
      member: member({ userId: 'u-1', user: { id: 'u-1', portalOnly: true } }),
    });
    await service.accept(TOKEN, { password: 'newpass99' }, client);
    expect(credentials.set).toHaveBeenCalledWith('u-1', 'newpass99', prisma);
    expect(sessions.revokeAllForUser).toHaveBeenCalledWith('u-1');
    expect(prisma.user.create).not.toHaveBeenCalled();
  });

  it("won't use a reset link once the login also opens another owner's group", async () => {
    const { service, credentials, sessions } = setup({
      link: waiting({ kind: 'RESET' }),
      member: member({ userId: 'u-1', user: { id: 'u-1', portalOnly: true } }),
      otherOwnerGroups: 1,
    });
    await expect(service.accept(TOKEN, { password: 'newpass99' }, client)).rejects.toThrow();
    expect(credentials.set).not.toHaveBeenCalled();
    expect(sessions.revokeAllForUser).not.toHaveBeenCalled();
  });

  it("won't add a group to its own owner, nor to a portal login of another owner's groups", async () => {
    await expect(setup({ link: waiting() }).service.attach(TOKEN, 'owner-1')).rejects.toThrow(/your own group/);
    const portal = setup({ link: waiting(), otherOwnerGroups: 1 });
    portal.prisma.user.findUniqueOrThrow.mockResolvedValue({ portalOnly: true });
    portal.prisma.groupMember.findFirst.mockResolvedValue(null);
    await expect(portal.service.attach(TOKEN, 'u-9')).rejects.toThrow(/another admin/);
  });
});

describe('GroupAccessService.sync', () => {
  it("activates the login with the role's access, and removes it when the role gives none", async () => {
    const { service, prisma } = setup();
    await service.sync(prisma as never, member({ userId: 'u-1', role: 'ACCOUNTANT' }) as never);
    expect(prisma.businessMember.upsert).toHaveBeenCalledWith(expect.objectContaining({ update: { role: 'ACCOUNTANT', status: 'ACTIVE' } }));
    await service.sync(prisma as never, member({ userId: 'u-1', role: 'MEMBER' }) as never);
    expect(prisma.businessMember.updateMany).toHaveBeenCalledWith({ where: { businessId: 'biz-1', userId: 'u-1' }, data: { status: 'REMOVED' } });
    expect(prisma.groupAccessLink.deleteMany).toHaveBeenCalledWith({ where: { groupMemberId: 'gm-1' } });
  });

  it("never touches the owner's own membership", async () => {
    const { service, prisma } = setup();
    await service.sync(prisma as never, member({ userId: 'owner-1', role: 'MEMBER' }) as never);
    expect(prisma.businessMember.updateMany).not.toHaveBeenCalled();
  });
});
