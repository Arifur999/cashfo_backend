import { ipv4Request } from './sms-http.js';
import { isUnicode, readMramBalance, readMramReply, toBdMobile } from './sms-text.js';
import { SmsService } from './sms.service.js';

vi.mock('./sms-http.js', () => ({ ipv4Request: vi.fn() }));
const request = vi.mocked(ipv4Request);
const answer = (text: string, status = 200) => request.mockResolvedValue({ status, text });

const config = (values: Record<string, string | undefined>) => ({ get: (key: string) => values[key] }) as never;

describe('toBdMobile', () => {
  it.each([
    ['01712345678', '8801712345678'],
    ['01712-345678', '8801712345678'],
    ['+880 1712 345678', '8801712345678'],
    ['8801912345678', '8801912345678'],
    ['1312345678', '8801312345678'],
  ])('reads %s', (raw, expected) => {
    expect(toBdMobile(raw)).toBe(expected);
  });

  it.each(['029123456', '01212345678', '+44 7911 123456', '0171234567', '017123456789', ''])('refuses %s', (raw) => {
    expect(toBdMobile(raw)).toBeNull();
  });
});

describe('MRAM replies', () => {
  it('reads an error code as a refusal', () => {
    expect(readMramReply('1002')).toEqual({ ok: false, code: '1002', reason: 'Sender ID not found' });
    expect(readMramReply(' 1007\n')).toEqual({ ok: false, code: '1007', reason: 'Balance insufficient' });
    expect(readMramReply('')).toEqual({ ok: false, code: 'EMPTY', reason: 'No answer' });
  });

  it('reads anything else as accepted, with its id when there is one', () => {
    expect(readMramReply('SMS SUBMITTED: ID - C20000123abc')).toEqual({ ok: true, id: 'C20000123abc' });
    expect(readMramReply('SMS SUBMITTED')).toEqual({ ok: true, id: 'SMS SUBMITTED' });
  });

  it('reads a number outside the code table as the shoot id, as furnify does', () => {
    expect(readMramReply('2001')).toEqual({ ok: true, id: '2001' });
    expect(readMramReply('"1016"')).toEqual({ ok: false, code: '1016', reason: 'This server address is not allowed' });
    expect(readMramReply('1007 - insufficient balance')).toEqual({ ok: false, code: '1007', reason: 'Balance insufficient' });
    const long = '{"shoot_id":"SH-1007-A9","accepted":2,"at":"2026-09-22T10:02:00Z"}';
    expect(readMramReply(long).ok).toBe(true);
  });

  it('reads the balance', () => {
    expect(readMramBalance('Your Balance is:BDT 203.25')).toBe(203.25);
    expect(readMramBalance('1003')).toBeNull();
    expect(readMramBalance('nothing')).toBeNull();
  });

  it('sends Bangla as unicode', () => {
    expect(isUnicode('Smartly code: 123456')).toBe(false);
    expect(isUnicode('Smartly কোড: ১২৩৪৫৬')).toBe(true);
  });
});

describe('SmsService', () => {
  afterEach(() => request.mockReset());

  it('is off until both the key and the sender id are set', () => {
    expect(new SmsService(config({})).configured).toBe(false);
    expect(new SmsService(config({ SMS_API_KEY: 'k' })).configured).toBe(false);
    expect(new SmsService(config({ SMS_API_KEY: 'replace-with-your-key', SMS_SENDER_ID: 's' })).configured).toBe(false);
    expect(new SmsService(config({ SMS_API_KEY: 'k', SMS_SENDER_ID: 's' })).configured).toBe(true);
  });

  it('posts one transactional message to the normalised number', async () => {
    answer('SMS SUBMITTED: ID - C1');
    const sms = new SmsService(config({ SMS_API_KEY: 'key-1', SMS_SENDER_ID: '8809600000000' }));
    await sms.send('01712-345678', 'Smartly কোড: 123456');
    const [url, init] = request.mock.calls[0] as [string, { body: URLSearchParams }];
    expect(url).toBe('https://msg.mram.com.bd/smsapi');
    expect(Object.fromEntries(init.body)).toEqual({
      api_key: 'key-1',
      senderid: '8809600000000',
      type: 'unicode',
      contacts: '8801712345678',
      label: 'transactional',
      msg: 'Smartly কোড: 123456',
    });
    expect(sms.lastSend?.ok).toBe(true);
  });

  it('throws on a refusal without naming the key', async () => {
    answer('1007');
    const sms = new SmsService(config({ SMS_API_KEY: 'secret-key', SMS_SENDER_ID: 's' }));
    const error = await sms.send('01712345678', 'hi').catch((caught: Error) => caught);
    expect((error as Error).message).toBe('MRAM refused the SMS: 1007 Balance insufficient');
    expect((error as Error).message).not.toContain('secret-key');
    expect(sms.lastSend?.ok).toBe(false);
  });

  it('refuses a number that is not a Bangladeshi mobile before calling MRAM', async () => {
    const sms = new SmsService(config({ SMS_API_KEY: 'k', SMS_SENDER_ID: 's' }));
    await expect(sms.send('+44 7911 123456', 'hi')).rejects.toThrow('Not a Bangladeshi mobile number');
    expect(request).not.toHaveBeenCalled();
  });
});
