import { BadRequestException, Injectable } from '@nestjs/common';
import { CredentialsService } from '../auth/credentials.service.js';
import { OneTimeCodesService } from '../one-time-codes/one-time-codes.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { ConfirmRecoveryEmailDto, StartRecoveryEmailDto } from './dto/recovery-email.dto.js';

const ACTION = { en: 'add it as your recovery email', bn: 'রিকভারি ইমেইল হিসেবে যোগ করতে' };

// Settings › Security › Recovery email: a second address that password
// reset links go to as well. Adding one asks for the account's password
// (someone holding a signed-in device can't slip in their own), and a code
// sent to the address proves it is the person's.
@Injectable()
export class RecoveryEmailService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly credentials: CredentialsService,
    private readonly codes: OneTimeCodesService,
  ) {}

  async start(userId: string, dto: StartRecoveryEmailDto) {
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: userId }, select: { id: true, name: true, email: true, preferredLanguage: true } });
    if (dto.email === user.email) throw new BadRequestException('Use a different email from your sign-in email.');
    if (await this.credentials.has(userId)) {
      if (!dto.password || !(await this.credentials.verify(userId, dto.password)))
        throw new BadRequestException({ statusCode: 400, error: 'Bad Request', message: 'That password is not right.', reason: 'WRONG_PASSWORD' });
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
