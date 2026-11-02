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
  resendGapMs,
  resendProblem,
  verifyProblem,
  type CodeProblem,
} from './one-time-codes.js';
import { OtpSenders, type OtpMessage, type OtpRoute } from './otp-senders.js';

type Client = PrismaService | Prisma.TransactionClient;

// How a code goes out (see OneTimeCodesService.routes).
type Routing = { smsTo?: string; emailFirst?: boolean };

export interface CodeRecipient {
  id: string;
  name: string;
  email: string;
  emailVerified?: boolean;
  phone: string | null;
  // Set once the phone was proved theirs; only then do codes go by SMS.
  phoneVerifiedAt?: Date | null;
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

  // A fresh code for `purpose`, replacing any unused one (only those
  // matching `replace`, when given: one sign-in's code leaves another's
  // alone). Sent first and kept only once a way worked (Routing).
  async issue(person: CodeRecipient, purpose: OneTimeCodePurpose, payload: Prisma.InputJsonObject, action: OtpMessage['action'], options: Routing & { replace?: Prisma.OneTimeCodeWhereInput } = {}): Promise<Challenge> {
    return this.oneAtATime(person.id, purpose, () => this.issueNow(person, purpose, payload, action, options));
  }

  // The code still waiting for this person and `purpose` (within
  // `replace`, and when `belongs` says it is theirs) when there is one: as
  // it is inside the resend wait or once it was sent five times, else sent
  // again. A new one when none is waiting or the waiting one took its five
  // tries. So a double press or a retry never sends a stream of messages.
  async issueOrReuse(
    person: CodeRecipient,
    purpose: OneTimeCodePurpose,
    payload: Prisma.InputJsonObject,
    action: OtpMessage['action'],
    options: Routing & { replace?: Prisma.OneTimeCodeWhereInput; belongs?: (row: OneTimeCode) => boolean } = {},
  ): Promise<Challenge> {
    return this.oneAtATime(person.id, purpose, async () => {
      const now = new Date();
      const row = await this.prisma.oneTimeCode.findFirst({ where: { ...options.replace, userId: person.id, purpose, consumedAt: null, expiresAt: { gt: now } }, orderBy: { lastSentAt: 'desc' } });
      if (row && (options.belongs?.(row) ?? true)) {
        const problem = resendProblem(row, now, resendGapMs(purpose));
        if (problem === 'RESEND_TOO_SOON' || problem === 'TOO_MANY_SENDS') return this.challengeOf(row, now);
        if (!problem) return this.resendNow(person, row, action, options);
      }
      return this.issueNow(person, purpose, payload, action, options);
    });
  }

  // The same challenge with a new code, a minute after the last send (see
  // resendGapMs), at most five sends. The ten minutes start again; the tries
  // don't. The old code keeps working until the new one is sent. A
  // challenge `belongs` refuses answers 404, as one never sent would.
  async resend(person: CodeRecipient, id: string, purpose: OneTimeCodePurpose, action: OtpMessage['action'], options: Routing & { belongs?: (row: OneTimeCode) => boolean } = {}): Promise<Challenge> {
    return this.oneAtATime(person.id, purpose, async () => {
      const row = await this.find(person.id, id, purpose);
      if (options.belongs && !options.belongs(row)) throw notFound();
      return this.resendNow(person, row, action, options);
    });
  }

  // Checks a typed code and counts the try (kept even when the caller's own
  // checks fail later). A wrong code is an answer (with the tries left), so
  // a caller can count it its own way; a code that can't be used throws.
  async check(userId: string, id: string, purpose: OneTimeCodePurpose, code: string): Promise<{ ok: true; row: OneTimeCode } | { ok: false; attemptsLeft: number }> {
    const row = await this.find(userId, id, purpose);
    const now = new Date();
    const problem = verifyProblem(row, now);
    if (problem) throw refuse(problem);
    const { count } = await this.prisma.oneTimeCode.updateMany({
      where: { id, consumedAt: null, attempts: { lt: MAX_ATTEMPTS }, expiresAt: { gt: now } },
      data: { attempts: { increment: 1 } },
    });
    if (count === 0) throw refuse(verifyProblem(await this.find(userId, id, purpose), now) ?? 'TOO_MANY_ATTEMPTS');
    if (!codeMatches(code, id, row.codeHash)) return { ok: false, attemptsLeft: Math.max(0, MAX_ATTEMPTS - row.attempts - 1) };
    return { ok: true, row };
  }

  // check(), with a wrong code refused (400 CODE_WRONG and the tries left).
  // Returns the row, whose payload says what it confirms.
  async verify(userId: string, id: string, purpose: OneTimeCodePurpose, code: string): Promise<OneTimeCode> {
    const result = await this.check(userId, id, purpose, code);
    if (!result.ok) throw refuse('CODE_WRONG', { attemptsLeft: result.attemptsLeft });
    return result.row;
  }

  // One person's codes for one purpose are made and sent one at a time (a
  // transaction-long advisory lock), so two presses at once can't both send
  // or leave two live codes. Sending happens inside, so the wait is generous.
  private oneAtATime<T>(userId: string, purpose: OneTimeCodePurpose, work: () => Promise<T>): Promise<T> {
    return this.prisma.$transaction(
      async (tx) => {
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`one-time-code:${purpose}:${userId}`}))`;
        return work();
      },
      { maxWait: 10_000, timeout: 30_000 },
    );
  }

  private async issueNow(person: CodeRecipient, purpose: OneTimeCodePurpose, payload: Prisma.InputJsonObject, action: OtpMessage['action'], options: Routing & { replace?: Prisma.OneTimeCodeWhereInput }): Promise<Challenge> {
    const routes = this.routes(person, options);
    if (routes.length === 0) {
      throw new ServiceUnavailableException({
        statusCode: 503,
        error: 'Service Unavailable',
        message: options.smsTo ? 'Text messages cannot be sent right now. Please try again later.' : 'Codes cannot be sent right now. Please contact support.',
        reason: options.smsTo ? 'SMS_NOT_CONFIGURED' : 'EMAIL_NOT_CONFIGURED',
      });
    }
    const now = new Date();
    const id = randomUUID();
    const code = generateCode();
    const route = await this.deliver(routes, code, this.message(person, action));
    await this.prisma.oneTimeCode.deleteMany({ where: { ...options.replace, userId: person.id, purpose, consumedAt: null } });
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
    return this.challengeOf(row, now);
  }

  private async resendNow(person: CodeRecipient, row: OneTimeCode, action: OtpMessage['action'], options: Routing): Promise<Challenge> {
    const now = new Date();
    const gapMs = resendGapMs(row.purpose);
    const problem = resendProblem(row, now, gapMs);
    if (problem) throw refuse(problem, problem === 'RESEND_TOO_SOON' ? { retryAfterSec: resendAfterSec(row.lastSentAt, now, gapMs) } : {});
    // emailFirst picks again (the phone when the email stopped working);
    // any other code goes the way it went the first time.
    const routes = options.emailFirst ? this.senders.emailFirst(person) : this.sameWayAs(row);
    const code = generateCode();
    const route = await this.deliver(routes, code, this.message(person, action));
    const sent = await this.prisma.oneTimeCode.update({
      where: { id: row.id },
      data: { codeHash: hashCode(code, row.id), channel: route.sender.channel, destination: route.destination, sends: { increment: 1 }, lastSentAt: now, expiresAt: new Date(now.getTime() + CODE_TTL_MS) },
    });
    return this.challengeOf(sent, now);
  }

  // How a new code goes: smsTo to that phone by SMS (proving the number);
  // emailFirst by email with a verified phone to fall back on
  // (OtpSenders.emailFirst); otherwise the way pick() chooses.
  private routes(person: CodeRecipient, options: Routing): OtpRoute[] {
    if (options.emailFirst) return this.senders.emailFirst(person);
    const route = options.smsTo ? this.senders.smsTo(options.smsTo) : this.senders.pick(person);
    return route ? [route] : [];
  }

  // The way a code already went, to send it again.
  private sameWayAs(row: OneTimeCode): OtpRoute[] {
    const sender = this.senders.forChannel(row.channel);
    return sender ? [{ sender, destination: row.destination }] : [];
  }

  // Sends the code the first way that works; 503 CODE_NOT_SENT when none did.
  private async deliver(routes: OtpRoute[], code: string, message: OtpMessage): Promise<OtpRoute> {
    for (const route of routes) {
      try {
        await route.sender.send(route.destination, code, message);
        return route;
      } catch {
        // On to the next way, if there is one.
      }
    }
    throw this.notSent();
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

  // What the "enter the code" dialog shows for this row.
  challengeOf(row: OneTimeCode, now = new Date()): Challenge {
    return {
      challengeId: row.id,
      channel: row.channel,
      sentTo: row.channel === 'SMS' ? maskPhone(row.destination) : maskEmail(row.destination),
      resendAfterSec: resendAfterSec(row.lastSentAt, now, resendGapMs(row.purpose)),
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
