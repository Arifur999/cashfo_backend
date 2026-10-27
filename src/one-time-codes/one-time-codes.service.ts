import { HttpException, HttpStatus, Injectable, ServiceUnavailableException } from '@nestjs/common';
import { Prisma, type OneTimeCode, type OneTimeCodePurpose } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { maskEmail, maskPhone } from '../referrals/referral-money.js';
import { PrismaService } from '../prisma/prisma.service.js';
import {
  CODE_MESSAGES,
  CODE_TTL_MS,
  codeMatches,
  generateCode,
  hashCode,
  MAX_ATTEMPTS,
  MAX_SENDS,
  resendAfterSec,
  resendProblem,
  verifyProblem,
  type CodeProblem,
} from './one-time-codes.js';
import { OtpSenders, type OtpMessage } from './otp-senders.js';

type Client = PrismaService | Prisma.TransactionClient;

export interface CodeRecipient {
  id: string;
  name: string;
  email: string;
  phone: string | null;
  preferredLanguage: string;
}

// What the app shows on the "enter the code" dialog.
export interface Challenge {
  challengeId: string;
  channel: 'EMAIL' | 'SMS';
  sentTo: string;
  resendAfterSec: number;
  expiresAt: Date;
  attemptsLeft: number;
  sendsLeft: number;
}

const STATUS_OF: Record<CodeProblem | 'CODE_WRONG', HttpStatus> = {
  CODE_USED: HttpStatus.BAD_REQUEST,
  CODE_EXPIRED: HttpStatus.BAD_REQUEST,
  TOO_MANY_ATTEMPTS: HttpStatus.BAD_REQUEST,
  TOO_MANY_SENDS: HttpStatus.BAD_REQUEST,
  RESEND_TOO_SOON: HttpStatus.TOO_MANY_REQUESTS,
  CODE_WRONG: HttpStatus.BAD_REQUEST,
};

const refuse = (reason: CodeProblem | 'CODE_WRONG', extra: Record<string, number> = {}) =>
  new HttpException(
    {
      statusCode: STATUS_OF[reason],
      error: reason === 'RESEND_TOO_SOON' ? 'Too Many Requests' : 'Bad Request',
      message: CODE_MESSAGES[reason],
      reason,
      ...extra,
    },
    STATUS_OF[reason],
  );

const notFound = () =>
  new HttpException({ statusCode: 404, error: 'Not Found', message: CODE_MESSAGES.CHALLENGE_NOT_FOUND, reason: 'CHALLENGE_NOT_FOUND' }, HttpStatus.NOT_FOUND);

// Six-digit codes that confirm a sensitive step (a referral withdrawal
// today; later a vault reset or deleting the account). The caller keeps
// what the code confirms in `payload` and checks it again on use: issue()
// sends a code, verify() checks a typed one (counting the try), consume()
// uses it up inside the caller's transaction.
@Injectable()
export class OneTimeCodesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly senders: OtpSenders,
  ) {}

  // A fresh code for `purpose`, replacing any unused one. 503
  // EMAIL_NOT_CONFIGURED when no channel can send it.
  async issue(person: CodeRecipient, purpose: OneTimeCodePurpose, payload: Prisma.InputJsonObject, action: OtpMessage['action']): Promise<Challenge> {
    const route = this.senders.pick(person);
    if (!route) {
      throw new ServiceUnavailableException({
        statusCode: 503,
        error: 'Service Unavailable',
        message: 'Codes cannot be sent right now because email is not set up. Please contact support.',
        reason: 'EMAIL_NOT_CONFIGURED',
      });
    }
    const now = new Date();
    const id = randomUUID();
    const code = generateCode();
    await this.prisma.oneTimeCode.deleteMany({ where: { userId: person.id, purpose, consumedAt: null } });
    const row = await this.prisma.oneTimeCode.create({
      data: {
        id,
        userId: person.id,
        purpose,
        channel: route.sender.channel,
        destination: route.destination,
        codeHash: hashCode(code, id),
        payload,
        expiresAt: new Date(now.getTime() + CODE_TTL_MS),
        lastSentAt: now,
      },
    });
    try {
      await route.sender.send(route.destination, code, this.message(person, action));
    } catch {
      await this.prisma.oneTimeCode.delete({ where: { id } }).catch(() => undefined);
      throw this.notSent();
    }
    return this.challengeOf(row, now);
  }

  // The same challenge with a new code, a minute after the last send, at
  // most five sends. The ten minutes start again; the tries don't.
  async resend(person: CodeRecipient, id: string, purpose: OneTimeCodePurpose, action: OtpMessage['action']): Promise<Challenge> {
    const row = await this.find(person.id, id, purpose);
    const now = new Date();
    const problem = resendProblem(row, now);
    if (problem) throw refuse(problem, problem === 'RESEND_TOO_SOON' ? { retryAfterSec: resendAfterSec(row.lastSentAt, now) } : {});
    const sender = this.senders.forChannel(row.channel);
    if (!sender) throw this.notSent();
    const code = generateCode();
    const { count } = await this.prisma.oneTimeCode.updateMany({
      where: { id, consumedAt: null, sends: row.sends, lastSentAt: row.lastSentAt },
      data: { codeHash: hashCode(code, id), sends: { increment: 1 }, lastSentAt: now, expiresAt: new Date(now.getTime() + CODE_TTL_MS) },
    });
    // Another resend got in first.
    if (count === 0) throw refuse('RESEND_TOO_SOON', { retryAfterSec: 60 });
    try {
      await sender.send(row.destination, code, this.message(person, action));
    } catch {
      throw this.notSent();
    }
    return this.challengeOf(await this.prisma.oneTimeCode.findUniqueOrThrow({ where: { id } }), now);
  }

  // Checks a typed code and counts the try (kept even when the caller's own
  // checks fail later). Returns the row, whose payload says what it confirms.
  async verify(userId: string, id: string, purpose: OneTimeCodePurpose, code: string): Promise<OneTimeCode> {
    const row = await this.find(userId, id, purpose);
    const now = new Date();
    const problem = verifyProblem(row, now);
    if (problem) throw refuse(problem);
    const { count } = await this.prisma.oneTimeCode.updateMany({
      where: { id, consumedAt: null, attempts: { lt: MAX_ATTEMPTS }, expiresAt: { gt: now } },
      data: { attempts: { increment: 1 } },
    });
    if (count === 0) throw refuse(verifyProblem(await this.find(userId, id, purpose), now) ?? 'TOO_MANY_ATTEMPTS');
    if (!codeMatches(code, id, row.codeHash)) {
      throw refuse('CODE_WRONG', { attemptsLeft: Math.max(0, MAX_ATTEMPTS - row.attempts - 1) });
    }
    return row;
  }

  // Uses the code up, in the caller's transaction: false when it was
  // already used (a double submit).
  async consume(client: Client, id: string): Promise<boolean> {
    const { count } = await client.oneTimeCode.updateMany({ where: { id, consumedAt: null }, data: { consumedAt: new Date() } });
    return count === 1;
  }

  // Housekeeping: codes over and done with for a day go.
  async cleanup(now = new Date()) {
    const dayAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);
    await this.prisma.oneTimeCode.deleteMany({ where: { OR: [{ expiresAt: { lt: dayAgo } }, { consumedAt: { lt: dayAgo } }] } });
  }

  private async find(userId: string, id: string, purpose: OneTimeCodePurpose): Promise<OneTimeCode> {
    const row = await this.prisma.oneTimeCode.findFirst({ where: { id, userId, purpose } });
    if (!row) throw notFound();
    return row;
  }

  private message(person: CodeRecipient, action: OtpMessage['action']): OtpMessage {
    return { name: person.name, action, locale: person.preferredLanguage === 'BN' ? 'bn' : 'en', minutes: CODE_TTL_MS / 60_000 };
  }

  private challengeOf(row: OneTimeCode, now: Date): Challenge {
    return {
      challengeId: row.id,
      channel: row.channel,
      sentTo: row.channel === 'SMS' ? maskPhone(row.destination) : maskEmail(row.destination),
      resendAfterSec: resendAfterSec(row.lastSentAt, now),
      expiresAt: row.expiresAt,
      attemptsLeft: Math.max(0, MAX_ATTEMPTS - row.attempts),
      sendsLeft: Math.max(0, MAX_SENDS - row.sends),
    };
  }

  private notSent() {
    return new ServiceUnavailableException({
      statusCode: 503,
      error: 'Service Unavailable',
      message: 'We could not send the code. Please try again in a minute.',
      reason: 'CODE_NOT_SENT',
    });
  }
}
