import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ipv4Request } from './sms-http.js';
import { isUnicode, readMramBalance, readMramReply, toBdMobile } from './sms-text.js';

const DEFAULT_API_URL = 'https://msg.mram.com.bd';
const TIMEOUT_MS = 15_000;
const BALANCE_TTL_MS = 10 * 60 * 1000;

// A configured value, ignoring .env.example's "replace-with-..." placeholders.
const realValue = (value: string | undefined) => {
  const trimmed = value?.trim() ?? '';
  return trimmed && !trimmed.startsWith('replace-with') ? trimmed : '';
};

// Text SMS through MRAM (msg.mram.com.bd), for one-time codes today. Off
// until SMS_API_KEY and SMS_SENDER_ID are both set; a missing key only
// breaks send(), never boot (same as MailService).
@Injectable()
export class SmsService {
  private readonly logger = new Logger(SmsService.name);
  // The last send this server made, for the admin's system health. Per
  // process, lost on restart.
  private last: { at: Date; ok: boolean } | null = null;
  private cachedBalance: { at: number; value: number | null } | null = null;

  constructor(private readonly config: ConfigService) {}

  get configured(): boolean {
    return !!this.apiKey && !!this.senderId;
  }

  get lastSend(): { at: Date; ok: boolean } | null {
    return this.last;
  }

  private get apiKey() {
    return realValue(this.config.get<string>('SMS_API_KEY'));
  }

  private get senderId() {
    return realValue(this.config.get<string>('SMS_SENDER_ID'));
  }

  private get apiUrl() {
    return (realValue(this.config.get<string>('SMS_API_URL')) || DEFAULT_API_URL).replace(/\/+$/, '');
  }

  // Sends one transactional SMS; throws when the number can't take one or
  // MRAM refuses it. The key never reaches a log or an error.
  async send(to: string, text: string): Promise<void> {
    if (!this.configured) throw new Error('SMS is not set up');
    const contact = toBdMobile(to);
    if (!contact) throw new Error('Not a Bangladeshi mobile number');
    const body = new URLSearchParams({
      api_key: this.apiKey,
      senderid: this.senderId,
      type: isUnicode(text) ? 'unicode' : 'text',
      contacts: contact,
      label: 'transactional',
      msg: text,
    });
    try {
      const response = await ipv4Request(`${this.apiUrl}/smsapi`, { body, timeoutMs: TIMEOUT_MS });
      const reply = readMramReply(response.text);
      const httpOk = response.status >= 200 && response.status < 300;
      if (!httpOk || !reply.ok) {
        const why = reply.ok ? `HTTP ${response.status}` : `${reply.code} ${reply.reason}`;
        throw new Error(`MRAM refused the SMS: ${why}`);
      }
      this.cachedBalance = null;
      this.last = { at: new Date(), ok: true };
    } catch (err: unknown) {
      this.last = { at: new Date(), ok: false };
      const message = err instanceof Error ? err.message : String(err);
      this.logger.error(`SMS to ${contact.slice(0, 5)}…${contact.slice(-3)} failed: ${message}`);
      throw new Error(message.startsWith('MRAM refused') ? message : 'The SMS could not be sent');
    }
  }

  // The account's credit in taka, for the admin's system health; null when
  // SMS is off or MRAM doesn't answer. Asked at most every ten minutes.
  async balance(): Promise<number | null> {
    if (!this.configured) return null;
    if (this.cachedBalance && Date.now() - this.cachedBalance.at < BALANCE_TTL_MS) return this.cachedBalance.value;
    let value: number | null = null;
    try {
      const response = await ipv4Request(`${this.apiUrl}/miscapi/${encodeURIComponent(this.apiKey)}/getBalance`, { timeoutMs: TIMEOUT_MS });
      if (response.status === 200) value = readMramBalance(response.text);
    } catch {
      value = null;
    }
    this.cachedBalance = { at: Date.now(), value };
    return value;
  }
}
