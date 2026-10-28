import { ConflictException, HttpException } from '@nestjs/common';
import { canonicalPhone, decoyChallenge, PhoneService } from './phone.service.js';
import { UserProfileService } from './user-profile.service.js';

const USER = { id: 'user-1', email: 'u@example.com', sessionId: 'sess-1' };
const challenge = { challengeId: 'c-1', channel: 'SMS' };

const setup = ({ person = {} as Record<string, unknown>, others = null as object | null, hasPassword = true, passwordOk = true, smsOn = true } = {}) => {
  const me = { id: 'user-1', name: 'Rina', email: 'u@example.com', phone: '01712-345678', phoneVerifiedAt: null, preferredLanguage: 'EN', ...person };
  const prisma = {
    user: {
      findUniqueOrThrow: vi.fn().mockResolvedValue(me),
      findFirst: vi.fn().mockResolvedValue(others),
      update: vi.fn().mockImplementation(({ data }: { data: object }) => Promise.resolve(data)),
    },
    oneTimeCode: { findFirst: vi.fn().mockResolvedValue(null) },
    $transaction: vi.fn((run: (tx: unknown) => unknown) => run(prisma)),
  };
  const codes = {
    issue: vi.fn().mockResolvedValue(challenge),
    resend: vi.fn().mockResolvedValue(challenge),
    verify: vi.fn().mockResolvedValue({ id: 'c-1', payload: { phone: '+8801712345678' } }),
    consume: vi.fn().mockResolvedValue(true),
    challengeOf: vi.fn().mockReturnValue({ ...challenge, resendAfterSec: 30 }),
  };
  const credentials = { has: vi.fn().mockResolvedValue(hasPassword), verify: vi.fn().mockResolvedValue(passwordOk) };
  const sessions = { findActive: vi.fn().mockResolvedValue({ userId: 'user-1', createdAt: new Date() }) };
  const sms = { configured: smsOn };
  const userAuth = { canSignIn: vi.fn().mockReturnValue(true), createResetToken: vi.fn().mockResolvedValue('raw-token') };
  const service = new PhoneService(prisma as never, codes as never, credentials as never, sessions as never, sms as never, userAuth as never);
  return { service, prisma, codes, credentials, userAuth };
};

const reasonOf = async (promise: Promise<unknown>) => {
  const error = await promise.then(
    () => null,
    (caught: unknown) => caught,
  );
  expect(error).toBeInstanceOf(HttpException);
  return ((error as HttpException).getResponse() as { reason: string }).reason;
};

describe('canonicalPhone', () => {
  it('keeps one form of a Bangladeshi mobile', () => {
    expect(canonicalPhone('01712-345678')).toBe('+8801712345678');
    expect(canonicalPhone('+880 1712 345678')).toBe('+8801712345678');
    expect(canonicalPhone('02-9123456')).toBeNull();
    expect(canonicalPhone(null)).toBeNull();
  });
});

describe('PhoneService.startVerify', () => {
  it('asks for the account password, then texts a code to the number on the profile', async () => {
    const { service, codes, credentials } = setup();
    await expect(service.startVerify(USER, 'pw')).resolves.toBe(challenge);
    expect(credentials.verify).toHaveBeenCalledWith('user-1', 'pw');
    expect(codes.issue).toHaveBeenCalledWith(expect.objectContaining({ id: 'user-1' }), 'PHONE_VERIFY', { phone: '+8801712345678' }, expect.any(Object), {
      smsTo: '+8801712345678',
    });
  });

  it('refuses a wrong or missing password, so a stolen session cannot add a phone', async () => {
    expect(await reasonOf(setup({ passwordOk: false }).service.startVerify(USER, 'bad'))).toBe('WRONG_PASSWORD');
    expect(await reasonOf(setup().service.startVerify(USER, undefined))).toBe('WRONG_PASSWORD');
  });

  it('refuses no phone, a landline and an already verified phone', async () => {
    expect(await reasonOf(setup({ person: { phone: null } }).service.startVerify(USER, 'pw'))).toBe('NO_PHONE');
    expect(await reasonOf(setup({ person: { phone: '02-9123456' } }).service.startVerify(USER, 'pw'))).toBe('PHONE_NOT_MOBILE');
    expect(await reasonOf(setup({ person: { phoneVerifiedAt: new Date() } }).service.startVerify(USER, 'pw'))).toBe('PHONE_ALREADY_VERIFIED');
  });

  it('refuses a number verified on another account', async () => {
    const { service, codes } = setup({ others: { id: 'user-2' } });
    await expect(service.startVerify(USER, 'pw')).rejects.toBeInstanceOf(ConflictException);
    expect(codes.issue).not.toHaveBeenCalled();
  });
});

describe('PhoneService.confirmVerify', () => {
  it('marks the number verified, in its one form', async () => {
    const { service, prisma } = setup();
    await service.confirmVerify('user-1', 'c-1', '123456');
    expect(prisma.user.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'user-1' }, data: { phone: '+8801712345678', phoneVerifiedAt: expect.any(Date) } }),
    );
  });

  it('refuses when the number changed after the code was sent', async () => {
    const { service, prisma } = setup({ person: { phone: '01812345678' } });
    expect(await reasonOf(service.confirmVerify('user-1', 'c-1', '123456'))).toBe('PHONE_CHANGED');
    expect(prisma.user.update).not.toHaveBeenCalled();
  });
});

describe('PhoneService password reset', () => {
  const owner = { id: 'user-1', name: 'Rina', email: 'u@example.com', phone: '+8801712345678', phoneVerifiedAt: new Date(), preferredLanguage: 'EN' };

  it('texts a code to a verified number', async () => {
    const { service, codes, prisma } = setup({ others: owner });
    await expect(service.startReset('01712345678')).resolves.toBe(challenge);
    expect(prisma.user.findFirst).toHaveBeenCalledWith({ where: { phone: '+8801712345678', phoneVerifiedAt: { not: null }, role: 'USER' } });
    expect(codes.issue).toHaveBeenCalledWith(owner, 'PHONE_PASSWORD_RESET', { phone: '+8801712345678' }, expect.any(Object), { smsTo: '+8801712345678' });
  });

  it('answers an unknown number with a decoy that sends nothing', async () => {
    const { service, codes } = setup();
    const answer = await service.startReset('01712345678');
    expect(answer).toMatchObject({ channel: 'SMS', sentTo: '01712-•••678', attemptsLeft: 5 });
    expect(Object.keys(answer).sort()).toEqual(Object.keys(decoyChallenge('+8801712345678')).sort());
    expect(codes.issue).not.toHaveBeenCalled();
  });

  it('sends no second SMS within a minute', async () => {
    const { service, codes, prisma } = setup({ others: owner });
    prisma.oneTimeCode.findFirst.mockResolvedValue({ id: 'c-1' });
    await expect(service.startReset('01712345678')).resolves.toMatchObject({ resendAfterSec: 30 });
    expect(codes.issue).not.toHaveBeenCalled();
  });

  it('says so while SMS is off, for every number alike', async () => {
    expect(await reasonOf(setup({ smsOn: false, others: owner }).service.startReset('01712345678'))).toBe('SMS_NOT_CONFIGURED');
    expect(await reasonOf(setup({ smsOn: false }).service.startReset('01812345678'))).toBe('SMS_NOT_CONFIGURED');
  });

  it('turns the right code into a proved reset token', async () => {
    const { service, prisma, codes, userAuth } = setup({ others: owner });
    prisma.oneTimeCode.findFirst.mockResolvedValue({ id: 'c-1', userId: 'user-1' });
    await expect(service.confirmReset('01712345678', 'c-1', '123456')).resolves.toEqual({ resetToken: 'raw-token' });
    expect(codes.verify).toHaveBeenCalledWith('user-1', 'c-1', 'PHONE_PASSWORD_RESET', '123456');
    expect(userAuth.createResetToken).toHaveBeenCalledWith('user-1', { codeProven: true });
  });

  it("reads a decoy's id as a wrong code", async () => {
    const { service, userAuth } = setup();
    expect(await reasonOf(service.confirmReset('01712345678', 'c-9', '123456'))).toBe('CODE_WRONG');
    expect(userAuth.createResetToken).not.toHaveBeenCalled();
  });
});

describe('UserProfileService.updateProfile and the verified phone', () => {
  const profile = (current: { phone: string | null; phoneVerifiedAt: Date | null }) => {
    const prisma = {
      user: {
        findUniqueOrThrow: vi.fn().mockResolvedValue(current),
        update: vi.fn().mockResolvedValue({ id: 'user-1', ...current }),
      },
    };
    return { service: new UserProfileService(prisma as never, {} as never, {} as never), prisma };
  };

  it('drops the verification when the number changes', async () => {
    const { service, prisma } = profile({ phone: '+8801712345678', phoneVerifiedAt: new Date() });
    await service.updateProfile('user-1', { phone: '01812345678' });
    expect(prisma.user.update).toHaveBeenCalledWith({ where: { id: 'user-1' }, data: { phone: '01812345678', phoneVerifiedAt: null } });
  });

  it('keeps it when the same number is typed another way', async () => {
    const { service, prisma } = profile({ phone: '+8801712345678', phoneVerifiedAt: new Date() });
    await service.updateProfile('user-1', { name: 'Rina', phone: '01712-345678' });
    expect(prisma.user.update).toHaveBeenCalledWith({ where: { id: 'user-1' }, data: { name: 'Rina' } });
  });

  it('drops it when the number is removed', async () => {
    const { service, prisma } = profile({ phone: '+8801712345678', phoneVerifiedAt: new Date() });
    await service.updateProfile('user-1', { phone: '' });
    expect(prisma.user.update).toHaveBeenCalledWith({ where: { id: 'user-1' }, data: { phone: null, phoneVerifiedAt: null } });
  });

  it('leaves the phone alone when only the name changes', async () => {
    const { service, prisma } = profile({ phone: '+8801712345678', phoneVerifiedAt: new Date() });
    await service.updateProfile('user-1', { name: 'Rina' });
    expect(prisma.user.findUniqueOrThrow).not.toHaveBeenCalled();
    expect(prisma.user.update).toHaveBeenCalledWith({ where: { id: 'user-1' }, data: { name: 'Rina' } });
  });
});
