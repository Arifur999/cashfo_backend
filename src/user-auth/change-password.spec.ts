import { UserAuthService } from './user-auth.service.js';

const setup = (currentMatches = true) => {
  const prisma = { user: { findUnique: vi.fn().mockResolvedValue({ id: 'u-1' }) } };
  const credentials = { verify: vi.fn().mockResolvedValue(currentMatches), set: vi.fn().mockResolvedValue(undefined) };
  const devices = { endAllExcept: vi.fn().mockResolvedValue(undefined) };
  const none = {} as never;
  const service = new UserAuthService(prisma as never, none, none, credentials as never, none, none, devices as never, none, none, none, none, none);
  return { service, credentials, devices };
};

describe('UserAuthService.changePassword', () => {
  it('signs the other devices out unless the customer unticks it', async () => {
    const asked = setup();
    await asked.service.changePassword('u-1', 's-1', { currentPassword: 'old-pass-1', newPassword: 'new-pass-1' });
    expect(asked.devices.endAllExcept).toHaveBeenCalledWith('u-1', 's-1');

    const kept = setup();
    await kept.service.changePassword('u-1', 's-1', { currentPassword: 'old-pass-1', newPassword: 'new-pass-1', signOutOthers: false });
    expect(kept.credentials.set).toHaveBeenCalledWith('u-1', 'new-pass-1');
    expect(kept.devices.endAllExcept).not.toHaveBeenCalled();
  });

  it('changes nothing when the current password is wrong', async () => {
    const { service, credentials, devices } = setup(false);
    await expect(service.changePassword('u-1', 's-1', { currentPassword: 'nope', newPassword: 'new-pass-1' })).rejects.toThrow('Current password is incorrect');
    expect(credentials.set).not.toHaveBeenCalled();
    expect(devices.endAllExcept).not.toHaveBeenCalled();
  });
});
