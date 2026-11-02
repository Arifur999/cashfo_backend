import { ProfileCardService } from './profile-card.service.js';

const owner = (over: Record<string, unknown> = {}) => ({
  name: 'Shirin Akter',
  avatarUrl: 'https://i.ibb.co/a.png',
  coverUrl: 'https://i.ibb.co/c.png',
  createdAt: new Date('2026-10-01T00:00:00.000Z'),
  role: 'USER',
  status: 'ACTIVE',
  profileCardSharedAt: new Date('2026-11-01T00:00:00.000Z'),
  ...over,
});

const setup = (row: Record<string, unknown> | null, referralCode: string | null = 'AB12CD34') => {
  const prisma = {
    user: {
      findUnique: vi.fn().mockResolvedValue(row),
      findUniqueOrThrow: vi.fn().mockResolvedValue({ referralCode }),
      update: vi.fn().mockResolvedValue({}),
      updateMany: vi.fn().mockResolvedValue({ count: 1 }),
    },
  };
  const settings = { getReferralSettings: vi.fn().mockResolvedValue({ programLive: true, friendDiscountPct: 10 }) };
  return { service: new ProfileCardService(prisma as never, settings as never), prisma };
};

describe('ProfileCardService', () => {
  it("shows a shared card's name, photos and invite, and never the email, phone or address", async () => {
    const { service, prisma } = setup(owner());
    const card = await service.card(' ab12cd34 ');
    expect(card).toEqual({ code: 'AB12CD34', name: 'Shirin Akter', avatarUrl: 'https://i.ibb.co/a.png', coverUrl: 'https://i.ibb.co/c.png', memberSince: owner().createdAt, friendDiscountPct: 10 });
    const select = prisma.user.findUnique.mock.calls[0][0].select;
    expect(select).not.toHaveProperty('email');
    expect(select).not.toHaveProperty('phone');
    expect(select).not.toHaveProperty('address');
  });

  it('shows nothing for a card that is off, an admin, a suspended account or a bad code', async () => {
    for (const row of [owner({ profileCardSharedAt: null }), owner({ role: 'SUPER_ADMIN' }), owner({ status: 'SUSPENDED' }), null]) {
      await expect(setup(row).service.card('AB12CD34')).rejects.toMatchObject({ response: { reason: 'CARD_NOT_SHARED' } });
    }
    const { service, prisma } = setup(owner());
    await expect(service.card('../etc')).rejects.toMatchObject({ response: { reason: 'CARD_NOT_SHARED' } });
    expect(prisma.user.findUnique).not.toHaveBeenCalled();
  });

  it('turns sharing on with the referral code, keeping the first date, and off again', async () => {
    const { service, prisma } = setup(null);
    await expect(service.setShared('u1', true)).resolves.toEqual({ shared: true, code: 'AB12CD34' });
    expect(prisma.user.updateMany).toHaveBeenCalledWith({ where: { id: 'u1', profileCardSharedAt: null }, data: { profileCardSharedAt: expect.any(Date) } });

    await expect(service.setShared('u1', false)).resolves.toEqual({ shared: false, code: 'AB12CD34' });
    expect(prisma.user.update).toHaveBeenCalledWith({ where: { id: 'u1' }, data: { profileCardSharedAt: null } });
  });
});
