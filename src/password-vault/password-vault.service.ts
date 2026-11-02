import { BadRequestException, ConflictException, ForbiddenException, HttpException, HttpStatus, Injectable, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcrypt';
import { AuthSessionsService } from '../auth/auth-sessions.service.js';
import { CredentialsService } from '../auth/credentials.service.js';
import { MAX_SENDS } from '../one-time-codes/one-time-codes.js';
import { OneTimeCodesService, type CodeRecipient } from '../one-time-codes/one-time-codes.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { RECENT_SIGN_IN_MS } from '../two-step/two-step-codes.js';
import type { RequestUser } from '../user-auth/interfaces/request-user.interface.js';
import { CreateVaultEntryDto } from './dto/create-vault-entry.dto.js';
import { ResetVaultDto, StartVaultResetDto } from './dto/reset-vault.dto.js';
import { SetVaultPasswordDto } from './dto/set-vault-password.dto.js';
import { UnlockVaultDto, VerifyVaultUnlockDto } from './dto/unlock-vault.dto.js';
import { UpdateVaultEntryDto } from './dto/update-vault-entry.dto.js';
import { UpdateVaultSettingsDto } from './dto/vault-settings.dto.js';
import { securityCheckup, type Checkup } from './vault-checkup.js';
import { decryptVaultSecret, encryptVaultSecret, isSealedVaultText, openVaultText, sealVaultText, vaultPasswordFingerprint } from './vault-crypto.js';
import { VAULT_PASSWORD_MESSAGES, vaultPasswordProblem, type VaultPasswordProblem } from './vault-password-rule.js';
import { effectiveLockSeconds, expiresInSeconds, unlockState, windowStartBefore, type UnlockState } from './vault-unlock-limit.js';

type StoredEntry = { id: string; usernameOrEmail: string | null; holderName: string | null; notes: string | null; passwordCiphertext: string };

// What the reset code confirms: the sign-in that asked for it.
interface ResetPayload {
  sessionId: string;
}

// What the unlock code confirms: the sign-in that typed the vault password,
// and that password (a change or reset in between voids the code).
interface UnlockPayload {
  sessionId: string;
  ver: string;
}

// The email's "Enter this code to ..." lines.
const RESET_ACTION = { en: 'reset your vault password', bn: 'ভল্টের পাসওয়ার্ড রিসেট' };
const UNLOCK_ACTION = { en: 'open your Password Manager', bn: 'পাসওয়ার্ড ম্যানেজার খোলা' };

const staleChallenge = () =>
  new BadRequestException({ statusCode: 400, error: 'Bad Request', message: 'This code was sent to another sign-in. Start again.', reason: 'CHALLENGE_NOT_FOUND' });

const codeUsed = () => new BadRequestException({ statusCode: 400, error: 'Bad Request', message: 'This code was already used. Start again to get a new one.', reason: 'CODE_USED' });

// The vault's unlock code goes to one sign-in: its pending code is found,
// and replaced, by the session in its payload.
const sameSignIn = (sessionId: string) => ({ payload: { path: ['sessionId'], equals: sessionId } });

const tooManySends = (retryAfterSec: number) =>
  new HttpException(
    {
      statusCode: 429,
      error: 'Too Many Requests',
      message: 'We sent the code five times already. Use the last one, or try again in a few minutes.',
      reason: 'TOO_MANY_SENDS',
      retryAfterSec,
    },
    HttpStatus.TOO_MANY_REQUESTS,
  );

const weakPassword = (reason: VaultPasswordProblem) => new BadRequestException({ statusCode: 400, error: 'Bad Request', message: VAULT_PASSWORD_MESSAGES[reason], reason });

const lockedOut = (retryAfterSec: number) => {
  const minutes = Math.ceil(retryAfterSec / 60);
  return new HttpException(
    {
      statusCode: 429,
      error: 'Too Many Requests',
      message: `Too many wrong vault passwords. Try again in ${minutes} minute${minutes === 1 ? '' : 's'}.`,
      reason: 'VAULT_LOCKED_OUT',
      retryAfterSec,
    },
    HttpStatus.TOO_MANY_REQUESTS,
  );
};

const minutesOf = (seconds: number) => Math.round((seconds / 60) * 100) / 100;

@Injectable()
export class PasswordVaultService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
    private readonly credentials: CredentialsService,
    private readonly sessions: AuthSessionsService,
    private readonly codes: OneTimeCodesService,
  ) {}

  // Whether the vault is set up, and how many logins it holds (Home shows
  // the count on the vault card; the entries themselves stay locked).
  // hasAccountPassword: setting up or resetting the vault asks for the
  // account password, which a Google-only account doesn't have -- the app
  // says so before the form instead of after it.
  // Also the lock time (lockMinutes: the person's choice, null = the
  // server's; effectiveMinutes: what an unlock lasts) and the unlock tries
  // left in the current window, so the lock screen can say so up front.
  async getStatus(userId: string) {
    const [user, entryCount, hasAccountPassword] = await Promise.all([
      this.prisma.user.findUniqueOrThrow({
        where: { id: userId },
        select: { vaultPasswordHash: true, vaultLockMinutes: true, vaultUnlockFailures: true, vaultUnlockFailedAt: true },
      }),
      this.prisma.vaultEntry.count({ where: { userId } }),
      this.credentials.has(userId),
    ]);
    const tries = unlockState(user, new Date());
    return {
      hasVaultPassword: user.vaultPasswordHash !== null,
      entryCount,
      hasAccountPassword,
      ...this.lockView(user.vaultLockMinutes),
      triesLeft: tries.triesLeft,
      retryAfterSec: tries.retryAfterSec,
    };
  }

  // PATCH /api/vault/settings: how long an unlock lasts, from the next
  // unlock on.
  async updateSettings(userId: string, dto: UpdateVaultSettingsDto) {
    await this.prisma.user.update({ where: { id: userId }, data: { vaultLockMinutes: dto.lockMinutes } });
    return this.lockView(dto.lockMinutes);
  }

  private lockView(lockMinutes: number | null) {
    return { lockMinutes, effectiveMinutes: minutesOf(effectiveLockSeconds(lockMinutes, this.serverLockSeconds())) };
  }

  private serverLockSeconds(): number {
    return expiresInSeconds(this.configService.get<string>('VAULT_TOKEN_EXPIRES_IN'));
  }

  // Sets the first vault password, or changes it. Changing needs the
  // current vault password as well as the account password: the vault is
  // meant to stay shut even when the account password leaks. The first one
  // opens the new, empty vault straight away (nothing in it yet for the
  // emailed code to guard); a change locks it, as earlier unlocks end.
  async setVaultPassword(userId: string, dto: SetVaultPasswordDto) {
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: userId } });
    await this.requireAccountPassword(userId, dto.currentPassword);
    if (user.vaultPasswordHash) {
      const vaultMatches = !!dto.currentVaultPassword && (await bcrypt.compare(dto.currentVaultPassword, user.vaultPasswordHash));
      if (!vaultMatches) {
        throw new BadRequestException('Your current vault password is incorrect. Forgot it? Reset the vault password instead; your saved logins stay.');
      }
    }
    await this.checkNewVaultPassword(userId, user.name, dto.vaultPassword);
    const vaultPasswordHash = await bcrypt.hash(dto.vaultPassword, 10);
    // Only over the password read above: two setups (or changes) at once
    // can't both land, the second one silently replacing the first.
    const { count } = await this.prisma.user.updateMany({ where: { id: userId, vaultPasswordHash: user.vaultPasswordHash }, data: { vaultPasswordHash } });
    if (count === 0) {
      throw new ConflictException({ statusCode: 409, error: 'Conflict', message: 'Your vault password was just changed somewhere else. Reload the page and try again.', reason: 'VAULT_PASSWORD_CHANGED' });
    }
    if (user.vaultPasswordHash) return { success: true };
    return { success: true, ...this.vaultToken(userId, vaultPasswordHash, user.vaultLockMinutes) };
  }

  // "Forgot vault password?", step one: proves it's the owner (the account
  // password, or a fresh sign-in for a Google-only account) and emails a
  // six-digit code. The account password alone is not enough: the saved
  // logins stay through a reset, so a leaked account password must not be
  // all it takes to open them.
  async startReset(user: RequestUser, dto: StartVaultResetDto) {
    const person = await this.codeRecipient(user.id);
    await this.confirmIdentity(user, dto.currentPassword);
    const payload: ResetPayload = { sessionId: user.sessionId };
    return this.codes.issue(person, 'VAULT_RESET', { ...payload }, RESET_ACTION);
  }

  async resendResetCode(user: RequestUser, challengeId: string) {
    const person = await this.codeRecipient(user.id);
    return this.codes.resend(person, challengeId, 'VAULT_RESET', RESET_ACTION);
  }

  // Step two: the identity again, the code, and the new vault password. Only
  // the password that opens the vault changes -- the entries are sealed with
  // the server's key (vault-crypto.ts), so they open with the new one. The
  // unlock tries start again, and earlier unlocks end (their fingerprint no
  // longer matches). A confirm: 'DELETE_ALL_ENTRIES' from an older client is
  // accepted and ignored.
  async resetVault(user: RequestUser, dto: ResetVaultDto) {
    const userId = user.id;
    const person = await this.codeRecipient(userId);
    await this.confirmIdentity(user, dto.currentPassword);
    await this.checkNewVaultPassword(userId, person.name, dto.vaultPassword);
    const code = await this.codes.verify(userId, dto.challengeId, 'VAULT_RESET', dto.code);
    const payload = code.payload as unknown as ResetPayload | null;
    if (payload?.sessionId !== user.sessionId) throw staleChallenge();
    const vaultPasswordHash = await bcrypt.hash(dto.vaultPassword, 10);
    await this.prisma.$transaction(async (tx) => {
      if (!(await this.codes.consume(tx, code.id))) throw codeUsed();
      await tx.user.update({ where: { id: userId }, data: { vaultPasswordHash, vaultUnlockFailures: 0, vaultUnlockFailedAt: null } });
    });
    const entryCount = await this.prisma.vaultEntry.count({ where: { userId } });
    return { success: true, deletedEntries: 0, entryCount };
  }

  // Who a vault code (reset or unlock) goes to, and the vault password it
  // is for; refused when no vault is set up.
  private async codeRecipient(userId: string): Promise<CodeRecipient & { vaultPasswordHash: string }> {
    const user = await this.prisma.user.findUniqueOrThrow({
      where: { id: userId },
      select: { id: true, name: true, email: true, emailVerified: true, phone: true, phoneVerifiedAt: true, preferredLanguage: true, vaultPasswordHash: true },
    });
    if (!user.vaultPasswordHash) {
      throw new BadRequestException({ statusCode: 400, error: 'Bad Request', message: 'Set up a vault password first', reason: 'VAULT_NOT_SET_UP' });
    }
    return { ...user, vaultPasswordHash: user.vaultPasswordHash };
  }

  // The account password; a Google-only account has none, so a sign-in in
  // the last ten minutes stands in for it (as for two-step changes).
  private async confirmIdentity(user: RequestUser, password: string | undefined) {
    if (await this.credentials.has(user.id)) {
      if (!password || !(await this.credentials.verify(user.id, password))) {
        throw new BadRequestException('Your account password is incorrect');
      }
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

  // The rules in vault-password-rule.ts, then "not the account password".
  private async checkNewVaultPassword(userId: string, name: string, vaultPassword: string) {
    const problem = vaultPasswordProblem(vaultPassword, name);
    if (problem) throw weakPassword(problem);
    if (await this.credentials.verify(userId, vaultPassword)) throw weakPassword('VAULT_PASSWORD_IS_ACCOUNT_PASSWORD');
  }

  private async requireAccountPassword(userId: string, password: string) {
    if (await this.credentials.verify(userId, password)) return;
    if (!(await this.credentials.has(userId))) {
      throw new BadRequestException(
        'Your account has no password yet because you sign in with Google. Set one with "Forgot password?" on the sign-in page, then come back.',
      );
    }
    throw new BadRequestException('Your account password is incorrect');
  }

  // Unlocking is two steps. This is the first: the vault password. Wrong
  // tries -- passwords here and codes in verifyUnlock() -- are counted per
  // person (vault-unlock-limit.ts): ten in ten minutes, then a wait even for
  // the right ones. The right password sends a six-digit code, by email
  // first (OtpSenders.emailFirst), and verifyUnlock() opens the vault with
  // it. Asked again while this sign-in's code is still waiting, it answers
  // that code (sent again once the 30-second wait is over), so a double
  // press or a retry doesn't send a stream of emails.
  // VAULT_UNLOCK_CODE=off skips the code (an emergency switch for when no
  // code can be sent): the right password opens the vault, as it did before.
  async unlock(user: RequestUser, dto: UnlockVaultDto) {
    const userId = user.id;
    const now = new Date();
    const person = await this.prisma.user.findUniqueOrThrow({
      where: { id: userId },
      select: {
        name: true,
        email: true,
        emailVerified: true,
        phone: true,
        phoneVerifiedAt: true,
        preferredLanguage: true,
        vaultPasswordHash: true,
        vaultLockMinutes: true,
        vaultUnlockFailures: true,
        vaultUnlockFailedAt: true,
      },
    });
    if (!person.vaultPasswordHash) {
      throw new BadRequestException('Set up a vault password first');
    }
    const before = unlockState(person, now);
    if (before.lockedOut) throw lockedOut(before.retryAfterSec);

    const matches = await bcrypt.compare(dto.vaultPassword, person.vaultPasswordHash);
    if (!matches) {
      const after = await this.recordFailedUnlock(userId, now);
      if (after.lockedOut) throw lockedOut(after.retryAfterSec);
      throw new HttpException(
        { statusCode: 401, error: 'Unauthorized', message: 'Incorrect vault password', reason: 'VAULT_PASSWORD_WRONG', triesLeft: after.triesLeft },
        HttpStatus.UNAUTHORIZED,
      );
    }
    if (this.configService.get<string>('VAULT_UNLOCK_CODE') === 'off') {
      await this.clearFailedUnlocks(userId, person);
      return this.vaultToken(userId, person.vaultPasswordHash, person.vaultLockMinutes);
    }

    const recipient: CodeRecipient = { id: userId, ...person };
    const ver = vaultPasswordFingerprint(person.vaultPasswordHash);
    const pending = await this.codes.pending(userId, 'VAULT_UNLOCK', sameSignIn(user.sessionId), now);
    if (pending && (pending.payload as unknown as UnlockPayload | null)?.ver === ver) {
      if (pending.sends >= MAX_SENDS) {
        // Sent five times already: no more emails until it runs out.
        throw tooManySends(Math.max(1, Math.ceil((pending.expiresAt.getTime() - now.getTime()) / 1000)));
      }
      const same = await this.codes.again(recipient, pending, UNLOCK_ACTION, now);
      if (same) return { codeRequired: true as const, ...same };
    }
    const payload: UnlockPayload = { sessionId: user.sessionId, ver };
    const challenge = await this.codes.issue(recipient, 'VAULT_UNLOCK', { ...payload }, UNLOCK_ACTION, { emailFirst: true, replace: sameSignIn(user.sessionId) });
    return { codeRequired: true as const, ...challenge };
  }

  // A new unlock code (the old one stops working), half a minute after the
  // last; only for the sign-in it was sent to, and while its vault password
  // is still the one set.
  async resendUnlockCode(user: RequestUser, challengeId: string) {
    const person = await this.codeRecipient(user.id);
    const row = await this.codes.peek(user.id, challengeId, 'VAULT_UNLOCK');
    const payload = row.payload as unknown as UnlockPayload | null;
    if (payload?.sessionId !== user.sessionId || payload.ver !== vaultPasswordFingerprint(person.vaultPasswordHash)) throw staleChallenge();
    return this.codes.resend(person, challengeId, 'VAULT_UNLOCK', UNLOCK_ACTION);
  }

  private async clearFailedUnlocks(userId: string, row: { vaultUnlockFailures: number; vaultUnlockFailedAt: Date | null }) {
    if (row.vaultUnlockFailures !== 0 || row.vaultUnlockFailedAt) {
      await this.prisma.user.update({ where: { id: userId }, data: { vaultUnlockFailures: 0, vaultUnlockFailedAt: null } });
    }
  }

  // The second step: the code opens the vault, for this sign-in and only
  // while the vault password is the one typed in step one. A wrong code
  // counts as a wrong unlock try for the person as well as for the code
  // (five per code), so asking for new codes doesn't buy more guesses, and
  // a vault locked out by wrong tries won't open with a code sent before.
  // An unlock lasts the person's lock time, capped by VAULT_TOKEN_EXPIRES_IN.
  async verifyUnlock(user: RequestUser, dto: VerifyVaultUnlockDto) {
    const userId = user.id;
    const now = new Date();
    const person = await this.prisma.user.findUniqueOrThrow({
      where: { id: userId },
      select: { vaultPasswordHash: true, vaultLockMinutes: true, vaultUnlockFailures: true, vaultUnlockFailedAt: true },
    });
    if (!person.vaultPasswordHash) {
      throw new BadRequestException('Set up a vault password first');
    }
    const before = unlockState(person, now);
    if (before.lockedOut) throw lockedOut(before.retryAfterSec);

    let code: Awaited<ReturnType<OneTimeCodesService['verify']>>;
    try {
      code = await this.codes.verify(userId, dto.challengeId, 'VAULT_UNLOCK', dto.code);
    } catch (error) {
      const body = error instanceof HttpException ? (error.getResponse() as { reason?: string; attemptsLeft?: number }) : null;
      if (body?.reason !== 'CODE_WRONG') throw error;
      const after = await this.recordFailedUnlock(userId, now);
      if (after.lockedOut) throw lockedOut(after.retryAfterSec);
      throw new BadRequestException({ ...body, attemptsLeft: Math.min(body.attemptsLeft ?? after.triesLeft, after.triesLeft), triesLeft: after.triesLeft });
    }
    const payload = code.payload as unknown as UnlockPayload | null;
    const ver = vaultPasswordFingerprint(person.vaultPasswordHash);
    if (payload?.sessionId !== user.sessionId || payload.ver !== ver) throw staleChallenge();
    if (!(await this.codes.consume(this.prisma, code.id))) throw codeUsed();

    await this.clearFailedUnlocks(userId, person);
    return this.vaultToken(userId, person.vaultPasswordHash, person.vaultLockMinutes);
  }

  // An open vault: a token for the person's lock time (capped by
  // VAULT_TOKEN_EXPIRES_IN), tied to this vault password.
  private vaultToken(userId: string, vaultPasswordHash: string, lockMinutes: number | null) {
    const now = new Date();
    const seconds = effectiveLockSeconds(lockMinutes, this.serverLockSeconds());
    const ver = vaultPasswordFingerprint(vaultPasswordHash);
    const vaultToken = this.jwtService.sign({ sub: userId, scope: 'vault', ver }, { secret: this.configService.get<string>('VAULT_TOKEN_SECRET'), expiresIn: seconds });
    // expiresIn stays a span string ("600s") for clients that parse it.
    return { vaultToken, expiresIn: `${seconds}s`, expiresInSec: seconds, expiresAt: new Date(now.getTime() + seconds * 1000) };
  }

  // One more wrong try, without losing one to a concurrent request: bump the
  // count inside a live window, or else start a new window at 1. Each step
  // is a conditional update, so two requests can't both start a window.
  private async recordFailedUnlock(userId: string, now: Date): Promise<UnlockState> {
    const windowStart = windowStartBefore(now);
    for (let attempt = 0; attempt < 3; attempt++) {
      const bumped = await this.prisma.user.updateMany({ where: { id: userId, vaultUnlockFailedAt: { gt: windowStart } }, data: { vaultUnlockFailures: { increment: 1 } } });
      if (bumped.count > 0) break;
      const started = await this.prisma.user.updateMany({
        where: { id: userId, OR: [{ vaultUnlockFailedAt: null }, { vaultUnlockFailedAt: { lte: windowStart } }] },
        data: { vaultUnlockFailures: 1, vaultUnlockFailedAt: now },
      });
      if (started.count > 0) break;
    }
    const row = await this.prisma.user.findUniqueOrThrow({ where: { id: userId }, select: { vaultUnlockFailures: true, vaultUnlockFailedAt: true } });
    return unlockState(row, now);
  }

  async list(userId: string) {
    const entries = await this.prisma.vaultEntry.findMany({
      where: { userId },
      orderBy: { title: 'asc' },
    });
    // Entries saved before the login, holder name and notes were encrypted
    // get sealed now, the first time their owner opens the vault.
    for (const entry of entries.filter((e) => !isSealedVaultText(e.usernameOrEmail) || !isSealedVaultText(e.holderName) || !isSealedVaultText(e.notes))) {
      await this.prisma.vaultEntry.update({
        where: { id: entry.id },
        data: {
          usernameOrEmail: sealVaultText(openVaultText(entry.usernameOrEmail)),
          holderName: sealVaultText(openVaultText(entry.holderName)),
          notes: sealVaultText(openVaultText(entry.notes)),
        },
      });
    }
    // Never include passwordCiphertext in the list response -- a single
    // GET here should not hand back every stored secret at once. The eye
    // icon on each row calls reveal() individually instead.
    return entries.map((entry) => this.toSummary(entry));
  }

  // What the client sees of an entry: the text fields opened, the password
  // left out.
  private toSummary<T extends StoredEntry>(entry: T) {
    const { passwordCiphertext: _passwordCiphertext, ...rest } = entry;
    return { ...rest, usernameOrEmail: openVaultText(entry.usernameOrEmail), holderName: openVaultText(entry.holderName), notes: openVaultText(entry.notes) };
  }

  async create(userId: string, dto: CreateVaultEntryDto) {
    const { password, usernameOrEmail, holderName, notes, ...rest } = dto;
    const entry = await this.prisma.vaultEntry.create({
      data: {
        ...rest,
        userId,
        usernameOrEmail: sealVaultText(usernameOrEmail),
        holderName: sealVaultText(holderName),
        notes: sealVaultText(notes),
        passwordCiphertext: encryptVaultSecret(password),
      },
    });
    return this.toSummary(entry);
  }

  async update(userId: string, id: string, dto: UpdateVaultEntryDto) {
    const current = await this.assertOwnership(userId, id);
    const { password, usernameOrEmail, holderName, notes, ...rest } = dto;
    // Only a new password moves its age (and brings back any checkup
    // warning marked fine); the same one saved again is no change.
    const changed = !!password && password !== decryptVaultSecret(current.passwordCiphertext);
    const entry = await this.prisma.vaultEntry.update({
      where: { id },
      data: {
        ...rest,
        ...(usernameOrEmail !== undefined && { usernameOrEmail: sealVaultText(usernameOrEmail) }),
        ...(holderName !== undefined && { holderName: sealVaultText(holderName) }),
        ...(notes !== undefined && { notes: sealVaultText(notes) }),
        ...(changed && password ? { passwordCiphertext: encryptVaultSecret(password), passwordChangedAt: new Date() } : {}),
      },
    });
    return this.toSummary(entry);
  }

  // The security checkup: the ids of the logins whose password is weak,
  // used for more than one login, or over a year old. The passwords are
  // compared here and never sent.
  async checkup(userId: string): Promise<Checkup> {
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: userId }, select: { name: true, phone: true } });
    const entries = await this.prisma.vaultEntry.findMany({ where: { userId }, select: { id: true, passwordCiphertext: true, passwordChangedAt: true, checkupDismissedAt: true } });
    return securityCheckup(
      entries.map((entry) => ({ id: entry.id, password: decryptVaultSecret(entry.passwordCiphertext), passwordChangedAt: entry.passwordChangedAt, checkupDismissedAt: entry.checkupDismissedAt })),
      user,
      new Date(),
    );
  }

  // "It's fine": the checkup stops flagging this login until its password
  // changes.
  async dismissCheckup(userId: string, id: string) {
    await this.assertOwnership(userId, id);
    const entry = await this.prisma.vaultEntry.update({ where: { id }, data: { checkupDismissedAt: new Date() } });
    return this.toSummary(entry);
  }

  async remove(userId: string, id: string) {
    await this.assertOwnership(userId, id);
    await this.prisma.vaultEntry.delete({ where: { id } });
    return { success: true };
  }

  async reveal(userId: string, id: string) {
    const entry = await this.assertOwnership(userId, id);
    return { password: decryptVaultSecret(entry.passwordCiphertext) };
  }

  private async assertOwnership(userId: string, id: string) {
    const entry = await this.prisma.vaultEntry.findUnique({ where: { id } });
    if (!entry) {
      throw new NotFoundException('Vault entry not found');
    }
    if (entry.userId !== userId) {
      throw new ForbiddenException('You do not have access to this vault entry');
    }
    return entry;
  }
}
