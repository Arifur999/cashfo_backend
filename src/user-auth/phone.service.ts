import { BadRequestException, ConflictException, HttpException, HttpStatus, Injectable, ServiceUnavailableException } from '@nestjs/common';
import { Role, type OneTimeCode } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { AuthSessionsService } from '../auth/auth-sessions.service.js';
import { CredentialsService } from '../auth/credentials.service.js';
import { CODE_MESSAGES, CODE_TTL_MS, MAX_ATTEMPTS, MAX_SENDS } from '../one-time-codes/one-time-codes.js';
import { OneTimeCodesService, type Challenge, type CodeRecipient } from '../one-time-codes/one-time-codes.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { maskPhone } from '../referrals/referral-money.js';
import { toBdMobile } from '../sms/sms-text.js';
import { SmsService } from '../sms/sms.service.js';
import { RECENT_SIGN_IN_MS } from '../two-step/two-step-codes.js';
import type { RequestUser } from './interfaces/request-user.interface.js';
import { UserAuthService } from './user-auth.service.js';

const VERIFY_ACTION = { en: 'verify your phone number', bn: 'ফোন নম্বর যাচাই' };
const RESET_ACTION = { en: 'reset your password', bn: 'পাসওয়ার্ড রিসেট' };
const RESEND_GAP_MS = 60_000;

// The one form a verified phone is kept in: +8801XXXXXXXXX.
export const canonicalPhone = (raw: string | null | undefined): string | null => {
  const mobile = raw ? toBdMobile(raw) : null;
  return mobile ? `+${mobile}` : null;
};

const refuse = (reason: string, message: string) => new BadRequestException({ statusCode: 400, error: 'Bad Request', message, reason });

const phoneOf = (payload: unknown): string | null => {
  const value = payload && typeof payload === 'object' ? (payload as { phone?: unknown }).phone : null;
  return typeof value === 'string' ? value : null;
};

// What an unknown number gets from "Forgot password" by phone: the same
// shape a real code answers with, so the page can't tell who has an account.
export const decoyChallenge = (phone: string, challengeId: string = randomUUID(), now = new Date()): Challenge => ({
  challengeId,
  channel: 'SMS',
  sentTo: maskPhone(phone),
  resendAfterSec: RESEND_GAP_MS / 1000,
  expiresAt: new Date(now.getTime() + CODE_TTL_MS),
  attemptsLeft: MAX_ATTEMPTS,
  sendsLeft: MAX_SENDS - 1,
});

// A customer's phone number: proving it with an SMS code (Settings >
// Profile), and "Forgot password" by a proved phone. Only a verified phone
// gets codes by SMS, and one number is verified on one account at most.
@Injectable()
export class PhoneService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly codes: OneTimeCodesService,
    private readonly credentials: CredentialsService,
    private readonly sessions: AuthSessionsService,
    private readonly sms: SmsService,
    private readonly userAuth: UserAuthService,
  ) {}

  // The account password (a Google-only account: a sign-in in the last ten
  // minutes) first, so a stolen session can't put the thief's phone on the
  // account; then a code to the number on the profile.
  async startVerify(user: RequestUser, password: string | undefined): Promise<Challenge> {
    const person = await this.person(user.id);
    if (person.phoneVerifiedAt) throw refuse('PHONE_ALREADY_VERIFIED', 'This number is already verified.');
    const phone = canonicalPhone(person.phone);
    if (!person.phone) throw refuse('NO_PHONE', 'Add your phone number first.');
    if (!phone) throw refuse('PHONE_NOT_MOBILE', 'Use a Bangladeshi mobile number, like 01712-345678.');
    await this.confirmIdentity(user, password);
    await this.assertFree(user.id, phone);
    return this.codes.issue(person, 'PHONE_VERIFY', { phone }, VERIFY_ACTION, { smsTo: phone });
  }

  async resendVerify(userId: string, challengeId: string): Promise<Challenge> {
    return this.codes.resend(await this.person(userId), challengeId, 'PHONE_VERIFY', VERIFY_ACTION);
  }

  async confirmVerify(userId: string, challengeId: string, code: string) {
    const row = await this.codes.verify(userId, challengeId, 'PHONE_VERIFY', code);
    const phone = canonicalPhone((await this.person(userId)).phone);
    if (!phone || phoneOf(row.payload) !== phone) throw refuse('PHONE_CHANGED', 'The number changed after the code was sent. Start again.');
    await this.assertFree(userId, phone);
    return this.prisma.$transaction(async (tx) => {
      if (!(await this.codes.consume(tx, row.id))) throw refuse('CODE_USED', CODE_MESSAGES.CODE_USED);
      return tx.user.update({ where: { id: userId }, data: { phone, phoneVerifiedAt: new Date() }, select: { phone: true, phoneVerifiedAt: true } });
    });
  }

  // "Forgot password" by phone: a code to the verified number, or, for a
  // number no account has verified, a decoy that sends nothing. A code sent
  // under a minute ago is answered again instead of sending another SMS.
  async startReset(rawPhone: string): Promise<Challenge> {
    const phone = this.resetPhone(rawPhone);
    const owner = await this.resetOwner(phone);
    if (!owner) return decoyChallenge(phone);
    const recent = await this.prisma.oneTimeCode.findFirst({
      where: { userId: owner.id, purpose: 'PHONE_PASSWORD_RESET', consumedAt: null, lastSentAt: { gt: new Date(Date.now() - RESEND_GAP_MS) } },
    });
    if (recent) return this.codes.challengeOf(recent);
    return this.codes.issue(owner, 'PHONE_PASSWORD_RESET', { phone }, RESET_ACTION, { smsTo: phone });
  }

  async resendReset(rawPhone: string, challengeId: string): Promise<Challenge> {
    const phone = this.resetPhone(rawPhone);
    const row = await this.resetCode(phone, challengeId);
    const owner = row && (await this.resetOwner(phone));
    if (!row || !owner || owner.id !== row.userId) return decoyChallenge(phone, challengeId);
    return this.codes.resend(owner, challengeId, 'PHONE_PASSWORD_RESET', RESET_ACTION);
  }

  // The right code gives a reset token for the usual "choose a new password"
  // page, marked as proved so it asks for no second code. A decoy's id reads
  // as a wrong code.
  async confirmReset(rawPhone: string, challengeId: string, code: string): Promise<{ resetToken: string }> {
    const phone = this.resetPhone(rawPhone);
    const row = await this.resetCode(phone, challengeId);
    const owner = row && (await this.resetOwner(phone));
    if (!row || !owner || owner.id !== row.userId) {
      throw new HttpException(
        { statusCode: 400, error: 'Bad Request', message: CODE_MESSAGES.CODE_WRONG, reason: 'CODE_WRONG', attemptsLeft: MAX_ATTEMPTS - 1 },
        HttpStatus.BAD_REQUEST,
      );
    }
    await this.codes.verify(owner.id, challengeId, 'PHONE_PASSWORD_RESET', code);
    if (!(await this.codes.consume(this.prisma, challengeId))) throw refuse('CODE_USED', CODE_MESSAGES.CODE_USED);
    return { resetToken: await this.userAuth.createResetToken(owner.id, { codeProven: true }) };
  }

  // A malformed number is refused the same for everyone; while SMS is off
  // nobody gets a code, so that says nothing about an account either.
  private resetPhone(rawPhone: string): string {
    const phone = canonicalPhone(rawPhone);
    if (!phone) throw refuse('PHONE_NOT_MOBILE', 'Use a Bangladeshi mobile number, like 01712-345678.');
    if (!this.sms.configured) {
      throw new ServiceUnavailableException({
        statusCode: 503,
        error: 'Service Unavailable',
        message: 'Text messages cannot be sent right now. Please try again later.',
        reason: 'SMS_NOT_CONFIGURED',
      });
    }
    return phone;
  }

  // The customer account that verified this number and may sign in.
  private async resetOwner(phone: string) {
    const owner = await this.prisma.user.findFirst({ where: { phone, phoneVerifiedAt: { not: null }, role: Role.USER } });
    return owner && this.userAuth.canSignIn(owner) ? owner : null;
  }

  private resetCode(phone: string, challengeId: string): Promise<OneTimeCode | null> {
    return this.prisma.oneTimeCode.findFirst({ where: { id: challengeId, purpose: 'PHONE_PASSWORD_RESET', destination: phone } });
  }

  private async person(userId: string): Promise<CodeRecipient> {
    return this.prisma.user.findUniqueOrThrow({
      where: { id: userId },
      select: { id: true, name: true, email: true, phone: true, phoneVerifiedAt: true, preferredLanguage: true },
    });
  }

  private async assertFree(userId: string, phone: string) {
    const taken = await this.prisma.user.findFirst({ where: { phone, phoneVerifiedAt: { not: null }, id: { not: userId } }, select: { id: true } });
    if (taken) {
      throw new ConflictException({ statusCode: 409, error: 'Conflict', message: 'This number is already verified on another account.', reason: 'PHONE_TAKEN' });
    }
  }

  private async confirmIdentity(user: RequestUser, password: string | undefined) {
    if (await this.credentials.has(user.id)) {
      if (!password || !(await this.credentials.verify(user.id, password))) throw refuse('WRONG_PASSWORD', 'Your account password is incorrect');
      return;
    }
    const session = await this.sessions.findActive(user.sessionId);
    if (!session || session.userId !== user.id || Date.now() - session.createdAt.getTime() > RECENT_SIGN_IN_MS) {
      throw new HttpException(
        {
          statusCode: 403,
          error: 'Forbidden',
          message: 'For your safety, sign out and sign in again, then try this within 10 minutes.',
          reason: 'RECENT_SIGN_IN_REQUIRED',
        },
        HttpStatus.FORBIDDEN,
      );
    }
  }
}
