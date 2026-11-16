import { BadRequestException, HttpException, HttpStatus, Injectable } from '@nestjs/common';
import { AuthSessionsService } from '../auth/auth-sessions.service.js';
import { CredentialsService } from '../auth/credentials.service.js';
import { OneTimeCodesService } from '../one-time-codes/one-time-codes.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { RECENT_SIGN_IN_MS } from '../two-step/two-step-codes.js';
import type { RequestUser } from './interfaces/request-user.interface.js';
import { ConfirmRecoveryEmailDto, StartRecoveryEmailDto } from './dto/recovery-email.dto.js';

const ACTION = { en: 'add it as your recovery email', bn: 'রিকভারি ইমেইল হিসেবে যোগ করতে' };

// Settings › Security › Recovery email: a second address that password
// reset links go to as well. Adding one asks for the account's password,
// or, for an account with none (Google only), a sign-in made in the last
// few minutes, as adding a phone or two-step does: someone holding a
// signed-in device can't slip in their own address and reset the password
// through it. A code sent to the address proves it is the person's.
@Injectable()
export class RecoveryEmailService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly credentials: CredentialsService,
    private readonly codes: OneTimeCodesService,
    private readonly sessions: AuthSessionsService,
  ) {}

  async start(requester: RequestUser, dto: StartRecoveryEmailDto) {
    const userId = requester.id;
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: userId }, select: { id: true, name: true, email: true, preferredLanguage: true } });
    if (dto.email === user.email) throw new BadRequestException('Use a different email from your sign-in email.');
    if (await this.credentials.has(userId)) {
      if (!dto.password || !(await this.credentials.verify(userId, dto.password)))
        throw new BadRequestException({ statusCode: 400, error: 'Bad Request', message: 'That password is not right.', reason: 'WRONG_PASSWORD' });
    } else {
      const session = await this.sessions.findActive(requester.sessionId);
      if (!session || session.userId !== userId || Date.now() - session.createdAt.getTime() > RECENT_SIGN_IN_MS) {
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
    // The code goes to the new address, never by SMS.
    return this.codes.issue(
      { ...user, email: dto.email, emailVerified: true, phone: null, phoneVerifiedAt: null },
      'RECOVERY_EMAIL',
      { email: dto.email },
      ACTION,
    );
  }

  async confirm(userId: string, dto: ConfirmRecoveryEmailDto) {
    const row = await this.codes.verify(userId, dto.challengeId, 'RECOVERY_EMAIL', dto.code);
    const email = (row.payload as { email?: unknown } | null)?.email;
    if (typeof email !== 'string') throw new BadRequestException('This code is not for a recovery email.');
    return this.prisma.$transaction(async (tx) => {
      if (!(await this.codes.consume(tx, row.id))) throw new BadRequestException('This code was already used.');
      const user = await tx.user.update({ where: { id: userId }, data: { recoveryEmail: email }, select: { recoveryEmail: true } });
      return { recoveryEmail: user.recoveryEmail };
    });
  }

  async remove(userId: string) {
    await this.prisma.user.update({ where: { id: userId }, data: { recoveryEmail: null } });
    return { recoveryEmail: null };
  }
}
