import { UserAuthService } from './user-auth.service.js';

const setup = (session: { userId: string; impersonatedBy: string | null } | null = { userId: 'u-1', impersonatedBy: null }) => {
  const sessions = { findActive: vi.fn().mockResolvedValue(session) };
  const tokens = { verifyRefresh: vi.fn().mockReturnValue({ sub: 'u-1', sid: 's-1' }) };
  const devices = { end: vi.fn().mockResolvedValue(undefined), endAll: vi.fn().mockResolvedValue(undefined) };
  const none = {} as never;
  const service = new UserAuthService(none, none, none, none, sessions as never, tokens as never, devices as never, none, none, none, none, none);
  return { service, sessions, tokens, devices };
};

describe('UserAuthService.logout', () => {
  it('signs out this device', async () => {
    const { service, devices, sessions } = setup();
    await expect(service.logout('refresh')).resolves.toEqual({ success: true });
    expect(devices.end).toHaveBeenCalledWith('s-1');
    expect(devices.endAll).not.toHaveBeenCalled();
    expect(sessions.findActive).not.toHaveBeenCalled();
  });

  it('signs out every device when asked', async () => {
    const { service, devices } = setup();
    await service.logout('refresh', true);
    expect(devices.endAll).toHaveBeenCalledWith('u-1');
    expect(devices.end).not.toHaveBeenCalled();
  });

  it("never lets a super admin's read-only view sign the customer out everywhere", async () => {
    const { service, devices } = setup({ userId: 'u-1', impersonatedBy: 'admin-1' });
    await service.logout('refresh', true);
    expect(devices.endAll).not.toHaveBeenCalled();
    expect(devices.end).toHaveBeenCalledWith('s-1');
  });

  it('ends only its own session when that session is already gone', async () => {
    const { service, devices } = setup(null);
    await service.logout('refresh', true);
    expect(devices.endAll).not.toHaveBeenCalled();
    expect(devices.end).toHaveBeenCalledWith('s-1');
  });

  it('still answers when the token is no good', async () => {
    const { service, tokens, devices } = setup();
    tokens.verifyRefresh.mockImplementation(() => {
      throw new Error('bad token');
    });
    await expect(service.logout('junk', true)).resolves.toEqual({ success: true });
    expect(devices.end).not.toHaveBeenCalled();
    expect(devices.endAll).not.toHaveBeenCalled();
  });
});
