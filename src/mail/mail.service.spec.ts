import { MailService } from './mail.service.js';

const send = vi.fn();

vi.mock('resend', () => ({
  Resend: class {
    emails = { send };
  },
}));

const serviceWith = (getCached: () => Promise<{ platformName: string }>) => {
  const config = { get: vi.fn((key: string) => (key === 'RESEND_API_KEY' ? 're_test' : undefined)) };
  const settings = { getCached: vi.fn(getCached) };
  return { service: new MailService(config as never, settings as never), settings };
};

const sentEmail = () => send.mock.calls.at(-1)?.[0] as { to: string; subject: string; html: string; text: string };

beforeEach(() => {
  send.mockReset();
  send.mockResolvedValue({ error: null });
});

describe('MailService.platformName', () => {
  it('reads the cached platform name setting', async () => {
    const { service, settings } = serviceWith(async () => ({ platformName: 'Acme Books' }));
    await expect(service.platformName()).resolves.toBe('Acme Books');
    expect(settings.getCached).toHaveBeenCalled();
  });

  it.each([
    ['empty', ''],
    ['blank', '   '],
    ['still the old name', 'Money Management Tracker'],
  ])('falls back to Smartly when the setting is %s', async (_label, platformName) => {
    const { service } = serviceWith(async () => ({ platformName }));
    await expect(service.platformName()).resolves.toBe('Smartly');
  });

  it('falls back to Smartly when the settings cannot be read', async () => {
    const { service } = serviceWith(async () => {
      throw new Error('database down');
    });
    await expect(service.platformName()).resolves.toBe('Smartly');
  });
});

describe('MailService template sends', () => {
  it('passes the platform name to the welcome email', async () => {
    const { service } = serviceWith(async () => ({ platformName: 'Acme Books' }));
    await service.sendWelcomeEmail('nadia@example.com', 'Nadia');
    const email = sentEmail();
    expect(email.to).toBe('nadia@example.com');
    expect(email.subject).toBe('Welcome to Acme Books');
    expect(email.text).toContain('- Acme Books');
  });

  it('passes the platform name to the password reset email', async () => {
    const { service } = serviceWith(async () => ({ platformName: 'Acme Books' }));
    await service.sendPasswordResetEmail('nadia@example.com', 'Nadia', 'https://app.example/reset-password?token=abc');
    const email = sentEmail();
    expect(email.to).toBe('nadia@example.com');
    expect(email.text).toContain('https://app.example/reset-password?token=abc');
    expect(email.text).toContain('- Acme Books');
  });

  it('passes the platform name to the support reply email', async () => {
    const { service } = serviceWith(async () => ({ platformName: 'Acme Books' }));
    await service.sendSupportReplyEmail('nadia@example.com', 'Nadia', 'Export failed', 'Fixed now.', 'https://app.example/settings/help?message=t1');
    const email = sentEmail();
    expect(email.subject).toBe('Re: Export failed');
    expect(email.text).toContain('- Acme Books support');
  });

  it('signs as Smartly when the stored name is still the old one', async () => {
    const { service } = serviceWith(async () => ({ platformName: 'Money Management Tracker' }));
    await service.sendWelcomeEmail('nadia@example.com', 'Nadia');
    const email = sentEmail();
    expect(email.subject).toBe('Welcome to Smartly');
    expect(`${email.subject}${email.text}${email.html}`).not.toContain('Money Management Tracker');
  });

  it('still rejects when the provider fails, so callers can log it', async () => {
    send.mockResolvedValue({ error: { message: 'boom' } });
    const { service } = serviceWith(async () => ({ platformName: 'Smartly' }));
    await expect(service.sendWelcomeEmail('nadia@example.com', 'Nadia')).rejects.toThrow('Failed to send email');
  });
});
