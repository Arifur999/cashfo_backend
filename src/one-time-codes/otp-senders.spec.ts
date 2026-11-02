import { OtpSenders, otpSmsText, SmsOtpSender } from './otp-senders.js';

const sender = (channel: 'SMS' | 'EMAIL', configured: boolean) => ({ channel, isConfigured: () => configured, send: vi.fn() });

const senders = ({ sms = true, email = true } = {}) => new OtpSenders(sender('SMS', sms) as never, sender('EMAIL', email) as never, sender('EMAIL', false) as never);

const person = { email: 'a@example.com', phone: '+8801712345678' };

describe('OtpSenders.pick', () => {
  it('sends by SMS only to a verified phone', () => {
    expect(senders().pick({ ...person, phoneVerifiedAt: new Date() })).toMatchObject({ sender: { channel: 'SMS' }, destination: '+8801712345678' });
    expect(senders().pick({ ...person, phoneVerifiedAt: null })).toMatchObject({ sender: { channel: 'EMAIL' }, destination: 'a@example.com' });
    expect(senders().pick(person)).toMatchObject({ sender: { channel: 'EMAIL' } });
  });

  it('falls back to email while SMS is off, and to nothing when neither works', () => {
    expect(senders({ sms: false }).pick({ ...person, phoneVerifiedAt: new Date() })).toMatchObject({ sender: { channel: 'EMAIL' } });
    expect(senders({ sms: false, email: false }).pick({ ...person, phoneVerifiedAt: new Date() })).toBeNull();
  });

  it('sends a proving code to the given phone, or nowhere while SMS is off', () => {
    expect(senders({ email: false }).smsTo('01812345678')).toMatchObject({ sender: { channel: 'SMS' }, destination: '01812345678' });
    expect(senders({ sms: false }).smsTo('01812345678')).toBeNull();
  });
});

describe('OtpSenders.emailFirst', () => {
  const verified = { ...person, phoneVerifiedAt: new Date() };

  it('sends by email first, with a verified phone to fall back on', () => {
    expect(senders().emailFirst({ ...verified, emailVerified: true }).map((route) => route.sender.channel)).toEqual(['EMAIL', 'SMS']);
    expect(senders().emailFirst({ ...person, emailVerified: true }).map((route) => route.sender.channel)).toEqual(['EMAIL']);
  });

  it('tries the verified phone before an address never confirmed', () => {
    expect(senders().emailFirst({ ...verified, emailVerified: false }).map((route) => route.sender.channel)).toEqual(['SMS', 'EMAIL']);
  });

  it('has nothing when nothing can send', () => {
    expect(senders({ sms: false, email: false }).emailFirst(verified)).toEqual([]);
  });
});

describe('the code SMS', () => {
  it('fits one SMS part in either language', () => {
    const en = otpSmsText('Smartly', '123456', { locale: 'en', minutes: 10 });
    const bn = otpSmsText('Smartly', '123456', { locale: 'bn', minutes: 10 });
    expect(en).toBe("Your Smartly code is 123456. It works for 10 minutes. Don't share it with anyone.");
    expect(bn).toBe('Smartly কোড 123456। ১০ মিনিট কাজ করবে। কাউকে বলবেন না।');
    expect(en.length).toBeLessThanOrEqual(160);
    expect(bn.length).toBeLessThanOrEqual(70);
  });

  it('goes through SmsService with the platform name', async () => {
    const sms = { configured: true, send: vi.fn() };
    const mail = { platformName: vi.fn().mockResolvedValue('Smartly') };
    await new SmsOtpSender(sms as never, mail as never).send('01712345678', '654321', { name: 'A', action: { en: 'x', bn: 'y' }, locale: 'en', minutes: 10 });
    expect(sms.send).toHaveBeenCalledWith('01712345678', "Your Smartly code is 654321. It works for 10 minutes. Don't share it with anyone.");
  });
});
