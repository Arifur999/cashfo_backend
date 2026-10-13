import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service.js';
import { credentialAccountData, credentialAccountKey } from './credential-account.js';
import { hashPassword, verifyPassword } from './password.js';

type Db = PrismaService | Prisma.TransactionClient;

// Every password check or change in the app goes through here, so the app
// and better-auth always agree on where a password lives and how it is
// hashed (see credential-account.ts and password.ts).
@Injectable()
export class CredentialsService {
  constructor(private readonly prisma: PrismaService) {}

  // False for a wrong password and for an account without one (Google-only).
  async verify(userId: string, password: string): Promise<boolean> {
    const account = await this.prisma.authAccount.findUnique({ where: credentialAccountKey(userId), select: { password: true } });
    return account?.password ? verifyPassword(password, account.password) : false;
  }

  // Whether the account has a password at all -- a Google-only account has
  // none until it uses "Forgot password?".
  async has(userId: string): Promise<boolean> {
    const account = await this.prisma.authAccount.findUnique({ where: credentialAccountKey(userId), select: { password: true } });
    return !!account?.password;
  }

  // Sets or replaces the password. Pass a transaction client to make it part
  // of a larger write, e.g. creating the user it belongs to.
  async set(userId: string, password: string, db: Db = this.prisma): Promise<void> {
    const passwordHash = await hashPassword(password);
    await db.authAccount.upsert({
      where: credentialAccountKey(userId),
      create: credentialAccountData(userId, passwordHash),
      update: { password: passwordHash },
    });
  }
}
