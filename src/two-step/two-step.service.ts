import { BadRequestException, ConflictException, HttpException, HttpStatus, Injectable, Logger, NotFoundException, Optional } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { Prisma, type TwoStepPurpose } from '@prisma/client';
import { createHmac } from 'node:crypto';
import { AuthSessionsService, type ClientInfo } from '../auth/auth-sessions.service.js';
import { CredentialsService } from '../auth/credentials.service.js';
import { placeOfIp } from '../common/ip-country.js';
import { keyFromEnv, openSecret, sealSecret } from '../common/secret-box.js';
import { MailService } from '../mail/mail.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { SettingsService } from '../settings/settings.service.js';
import { parseDeviceLabel } from '../user-auth/device-label.js';
import { SecurityAlertsService } from '../user-auth/security-alerts.service.js';
import { generateTotpSecret, groupSecret, matchTotp, otpauthUrl } from './totp.js';
import {
  CHALLENGE_TTL_MS,
  challengeProblem,
  generateBackupCodes,
  hashBackupCode,
  hashToken,
  MAX_CHALLENGE_ATTEMPTS,
  newDeviceToken,
  normalizeBackupCode,
  parseTrustedTokens,
  RECENT_SIGN_IN_MS,
  SETUP_TTL_MS,
  TRUSTED_DEVICE_TTL_MS,
  TWO_STEP_MESSAGES,
  type ChallengeProblem,
} from './two-step-codes.js';

type Db = PrismaService | Prisma.TransactionClient;

// Which side an account signs in on: admin tokens or customer tokens.
export type TwoStepSide = 'admin' | 'user';

// What a sign-in answers instead of tokens when the code is still to come.
export interface TwoStepRequired {
  twoStepRequired: true;
  challengeToken: string;
  audience: TwoStepSide;
  expiresAt: Date;
  // "Signed in as nadia@example.com" on the code screen.
  email: string;
}

// An admin who must turn two-step on before getting in (Require it for
// everyone). setupToken stands in for a sign-in on the two set-up calls.
export interface TwoStepSetupRequired {
  twoStepSetupRequired: true;
  setupToken: string;
  audience: 'admin';
  expiresAt: Date;
  email: string;
}

export type TwoStepPending = TwoStepRequired | TwoStepSetupRequired;

export const isTwoStepPending = (result: object): result is TwoStepPending => 'twoStepRequired' in result || 'twoStepSetupRequired' in result;

// The second factor someone typed: a code from the app, or a backup code.
export interface TwoStepProof {
  code?: string;
  backupCode?: string;
}

// How the person proves it is them before changing two-step: their
// password, or for a Google-only account a sign-in in the last 10 minutes.
export interface Reauth {
  password?: string;
  sessionId: string;
}

interface ChallengeClaims {
  sub: string;
  jti: string;
  purpose: TwoStepPurpose;
}

const CHALLENGE_AUDIENCE = 'two-step';

const refuse = (reason: ChallengeProblem | 'CODE_WRONG' | 'BACKUP_CODE_WRONG', status: HttpStatus, extra: Record<string, unknown> = {}) =>
  new HttpException(
    { statusCode: status, error: status === HttpStatus.UNAUTHORIZED ? 'Unauthorized' : 'Bad Request', message: TWO_STEP_MESSAGES[reason], reason, ...extra },
    status,
  );

const expired = (reason: ChallengeProblem = 'CHALLENGE_EXPIRED') => refuse(reason, HttpStatus.UNAUTHORIZED);

// Two-step sign-in for customers and admins: the authenticator app (TOTP),
// ten backup codes, computers trusted for 30 days, and the short-lived
// challenge between the password and the code. The sign-in services call
// gate() after the password (or Google) checks out and before any token is
// issued; everything an account does about its own two-step comes here too.
@Injectable()
export class TwoStepService {
  private readonly logger = new Logger(TwoStepService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly jwt: JwtService,
    private readonly sessions: AuthSessionsService,
    private readonly credentials: CredentialsService,
    private readonly settings: SettingsService,
    private readonly mail: MailService,
    // A wrong code counts towards "Warn me about unusual sign-in tries".
    @Optional() private readonly alerts?: SecurityAlertsService,
  ) {}

  // ---- Sign-in ----

  // Null: sign the account straight in. Otherwise the better-auth session
  // the first step opened is ended (no token was ever bound to it) and the
  // caller answers with the pending step instead of tokens.
  async gate(user: { id: string; email: string }, sessionId: string, side: TwoStepSide, trustedHeader?: string | string[]): Promise<TwoStepPending | null> {
    const factor = await this.prisma.twoFactor.findUnique({ where: { userId: user.id }, select: { enabledAt: true } });
    if (factor?.enabledAt) {
      if (await this.matchTrustedDevice(user.id, trustedHeader)) return null;
      await this.sessions.revoke(sessionId);
      const { token, expiresAt } = await this.issueChallenge(user.id, 'SIGN_IN');
      return { twoStepRequired: true, challengeToken: token, audience: side, expiresAt, email: user.email };
    }
    if (side === 'admin' && (await this.requiredForAdmins())) {
      await this.sessions.revoke(sessionId);
      const { token, expiresAt } = await this.issueChallenge(user.id, 'SETUP');
      return { twoStepSetupRequired: true, setupToken: token, audience: 'admin', expiresAt, email: user.email };
    }
    return null;
  }

  // The second step of a sign-in: a code (or backup code) for the challenge.
  // Each wrong one counts against the challenge's five tries and lands in
  // the login history. Returns whose challenge it was, used up.
  async answerChallenge(challengeToken: string, proof: TwoStepProof, client: ClientInfo): Promise<{ userId: string; backupCodesLeft: number | null }> {
    const row = await this.openChallenge(challengeToken, 'SIGN_IN');
    const triesBefore = row.attempts;
    await this.countTry(row.id);
    const result = await this.checkProof(row.userId, proof);
    if (!result) {
      await this.recordFailure(row.userId, client);
      const attemptsLeft = Math.max(0, MAX_CHALLENGE_ATTEMPTS - triesBefore - 1);
      if (attemptsLeft === 0) throw expired('TOO_MANY_ATTEMPTS');
      throw refuse(proof.backupCode ? 'BACKUP_CODE_WRONG' : 'CODE_WRONG', HttpStatus.BAD_REQUEST, { attemptsLeft });
    }
    await this.consume(row.id);
    return { userId: row.userId, backupCodesLeft: result.backupCodesLeft };
  }

  // The admin a set-up token belongs to, while it is still good. Each set-up
  // call checks it; only enabling the code uses it up.
  async setupTokenOwner(setupToken: string): Promise<string> {
    const row = await this.openChallenge(setupToken, 'SETUP');
    return row.userId;
  }

  // "Don't ask again on this computer for 30 days": the raw token, once,
  // for the browser to keep in an httpOnly cookie.
  async trustDevice(userId: string, client: ClientInfo): Promise<{ token: string; expiresAt: Date }> {
    const token = newDeviceToken();
    const expiresAt = new Date(Date.now() + TRUSTED_DEVICE_TTL_MS);
    await this.prisma.trustedDevice.create({
      data: { userId, tokenHash: hashToken(token), userAgent: client.userAgent?.slice(0, 500), ipAddress: client.ipAddress, expiresAt },
    });
    return { token, expiresAt };
  }

  // ---- The account's own two-step (Settings > Security, My account) ----

  async status(userId: string, side: TwoStepSide, trustedHeader?: string | string[]) {
    const now = new Date();
    const [factor, backupCodesLeft, devices] = await Promise.all([
      this.prisma.twoFactor.findUnique({ where: { userId }, select: { enabledAt: true } }),
      this.prisma.twoFactorBackupCode.count({ where: { userId, usedAt: null } }),
      this.prisma.trustedDevice.findMany({ where: { userId, expiresAt: { gt: now } }, orderBy: { lastUsedAt: 'desc' } }),
    ]);
    const current = new Set(parseTrustedTokens(trustedHeader).map(hashToken));
    const enabled = Boolean(factor?.enabledAt);
    return {
      enabled,
      enabledAt: factor?.enabledAt ?? null,
      // A set-up was started (a code shown) but never confirmed.
      setupPending: Boolean(factor && !factor.enabledAt),
      backupCodesLeft: enabled ? backupCodesLeft : 0,
      // Admins only: whether every admin must use it.
      ...(side === 'admin' && { required: await this.requiredForAdmins() }),
      trustedDevices: devices.map((device) => ({
        id: device.id,
        deviceLabel: parseDeviceLabel(device.userAgent),
        ipAddress: device.ipAddress,
        place: placeOfIp(device.ipAddress),
        createdAt: device.createdAt,
        lastUsedAt: device.lastUsedAt,
        expiresAt: device.expiresAt,
        current: current.has(device.tokenHash),
      })),
    };
  }

  async isEnabled(userId: string): Promise<boolean> {
    const factor = await this.prisma.twoFactor.findUnique({ where: { userId }, select: { enabledAt: true } });
    return Boolean(factor?.enabledAt);
  }

  // A fresh secret for the app, shown as a QR (otpauthUrl) and as a key to
  // type. Nothing changes for sign-in until enable() confirms a code from it.
  async startSetup(user: { id: string; email: string }, side: TwoStepSide, reauth: Reauth | null): Promise<{ secret: string; otpauthUrl: string }> {
    if (reauth) await this.confirmIdentity(user.id, reauth);
    const existing = await this.prisma.twoFactor.findUnique({ where: { userId: user.id }, select: { enabledAt: true } });
    if (existing?.enabledAt) {
      throw new ConflictException('Two-step sign-in is already on. Turn it off first to set it up again.');
    }
    const secret = generateTotpSecret();
    const secretCiphertext = this.seal(secret);
    await this.prisma.twoFactor.upsert({
      where: { userId: user.id },
      create: { userId: user.id, secretCiphertext },
      update: { secretCiphertext, enabledAt: null, lastUsedStep: null },
    });
    return { secret: groupSecret(secret), otpauthUrl: await this.otpauthUrl(side, user.email, secret) };
  }

  // The first code from the app turns two-step on and hands out the ten
  // backup codes, once.
  async enable(userId: string, code: string): Promise<{ backupCodes: string[] }> {
    const factor = await this.prisma.twoFactor.findUnique({ where: { userId } });
    if (!factor) throw new BadRequestException('Start the set-up first: scan the code with your authenticator app.');
    if (factor.enabledAt) throw new ConflictException('Two-step sign-in is already on.');
    const step = matchTotp(this.open(factor.secretCiphertext), code, new Date());
    if (step === null) throw refuse('CODE_WRONG', HttpStatus.BAD_REQUEST);
    const backupCodes = await this.prisma.$transaction(async (tx) => {
      const { count } = await tx.twoFactor.updateMany({ where: { userId, enabledAt: null }, data: { enabledAt: new Date(), lastUsedStep: BigInt(step) } });
      if (count !== 1) throw new ConflictException('Two-step sign-in is already on.');
      return this.replaceBackupCodes(userId, tx);
    });
    return { backupCodes };
  }

  // Set-up during the sign-in of an admin who must have two-step: the code
  // also uses the set-up token up, so the caller can sign them in.
  async enableWithSetupToken(setupToken: string, code: string): Promise<{ userId: string; backupCodes: string[] }> {
    const row = await this.openChallenge(setupToken, 'SETUP');
    const triesBefore = row.attempts;
    await this.countTry(row.id);
    try {
      const { backupCodes } = await this.enable(row.userId, code);
      await this.consume(row.id);
      return { userId: row.userId, backupCodes };
    } catch (error) {
      if (error instanceof HttpException && (error.getResponse() as { reason?: string }).reason === 'CODE_WRONG') {
        const attemptsLeft = Math.max(0, MAX_CHALLENGE_ATTEMPTS - triesBefore - 1);
        if (attemptsLeft === 0) throw expired('TOO_MANY_ATTEMPTS');
        throw refuse('CODE_WRONG', HttpStatus.BAD_REQUEST, { attemptsLeft });
      }
      throw error;
    }
  }

  // New backup codes; the old ones stop working.
  async regenerateBackupCodes(userId: string, reauth: Reauth, code: string): Promise<{ backupCodes: string[] }> {
    await this.confirmIdentity(userId, reauth);
    if (!(await this.isEnabled(userId))) throw new BadRequestException('Two-step sign-in is off.');
    if (!(await this.checkProof(userId, { code }))) throw refuse('CODE_WRONG', HttpStatus.BAD_REQUEST);
    const backupCodes = await this.prisma.$transaction((tx) => this.replaceBackupCodes(userId, tx));
    return { backupCodes };
  }

  // Turning it off: the password and a code (or a backup code). Removes the
  // secret, the backup codes and every trusted computer.
  async disable(userId: string, side: TwoStepSide, reauth: Reauth, proof: TwoStepProof): Promise<void> {
    await this.confirmIdentity(userId, reauth);
    if (!(await this.isEnabled(userId))) throw new BadRequestException('Two-step sign-in is already off.');
    if (side === 'admin' && (await this.requiredForAdmins())) {
      throw new ConflictException('Two-step sign-in is required for every admin, so it cannot be turned off.');
    }
    if (!(await this.checkProof(userId, proof))) throw refuse(proof.backupCode ? 'BACKUP_CODE_WRONG' : 'CODE_WRONG', HttpStatus.BAD_REQUEST);
    await this.removeAll(userId);
  }

  // The check before something that can't be taken back (deleting the
  // account): the password, or a recent sign-in for a Google-only account,
  // and -- with two-step on -- a code from the app or a backup code too.
  async confirmSensitiveAction(userId: string, reauth: Reauth, proof: TwoStepProof): Promise<void> {
    await this.confirmIdentity(userId, reauth);
    if (!(await this.isEnabled(userId))) return;
    if (!proof.code && !proof.backupCode) {
      throw new HttpException(
        {
          statusCode: 400,
          error: 'Bad Request',
          message: 'Enter the 6-digit code from your authenticator app, or a backup code.',
          reason: 'TWO_STEP_CODE_REQUIRED',
        },
        HttpStatus.BAD_REQUEST,
      );
    }
    if (!(await this.checkProof(userId, proof))) throw refuse(proof.backupCode ? 'BACKUP_CODE_WRONG' : 'CODE_WRONG', HttpStatus.BAD_REQUEST);
  }

  // Someone else (a super admin) turning it off for an account that lost
  // its phone. False when it was not on.
  async removeAll(userId: string, db: Db = this.prisma): Promise<boolean> {
    const run = async (tx: Prisma.TransactionClient) => {
      const { count } = await tx.twoFactor.deleteMany({ where: { userId } });
      await tx.twoFactorBackupCode.deleteMany({ where: { userId } });
      await tx.trustedDevice.deleteMany({ where: { userId } });
      await tx.twoStepChallenge.deleteMany({ where: { userId } });
      return count > 0;
    };
    return '$transaction' in db ? db.$transaction(run) : run(db);
  }

  async removeTrustedDevice(userId: string, id: string): Promise<void> {
    const { count } = await this.prisma.trustedDevice.deleteMany({ where: { id, userId } });
    if (count === 0) throw new NotFoundException('Trusted device not found');
  }

  async removeTrustedDevices(userId: string): Promise<number> {
    const { count } = await this.prisma.trustedDevice.deleteMany({ where: { userId } });
    return count;
  }

  // ---- Pieces the admin invite reuses ----

  newSecret(): string {
    return generateTotpSecret();
  }

  seal(secret: string): string {
    return sealSecret(secret, this.encryptionKey());
  }

  open(ciphertext: string): string {
    return openSecret(ciphertext, this.encryptionKey());
  }

  async otpauthUrl(side: TwoStepSide, account: string, secret: string): Promise<string> {
    const platformName = await this.mail.platformName();
    // The board's wording: "type the 6-digit code for Money Tracker Admin".
    return otpauthUrl(side === 'admin' ? `${platformName} Admin` : platformName, account, secret);
  }

  // Writes ten new backup codes (removing any old ones) and returns them,
  // the only time they are ever readable.
  async replaceBackupCodes(userId: string, tx: Prisma.TransactionClient): Promise<string[]> {
    const codes = generateBackupCodes();
    const pepper = this.pepper();
    await tx.twoFactorBackupCode.deleteMany({ where: { userId } });
    await tx.twoFactorBackupCode.createMany({ data: codes.map((code) => ({ userId, codeHash: hashBackupCode(pepper, userId, normalizeBackupCode(code)!) })) });
    return codes;
  }

  // ---- Customer notices (bell + email); admins get audit entries instead ----

  async notifyCustomer(userId: string, kind: 'ON' | 'OFF' | 'OFF_BY_SUPPORT'): Promise<void> {
    const at = new Date();
    try {
      await this.prisma.userNotification.createMany({
        data: [
          {
            userId,
            key: `two-step:${kind.toLowerCase()}:${at.toISOString()}`,
            type: 'SECURITY',
            businessId: null,
            data: { event: `TWO_STEP_${kind}`, at: at.toISOString() },
          },
        ],
        skipDuplicates: true,
      });
    } catch (error) {
      this.logger.warn(`Two-step bell row for ${userId} failed: ${error instanceof Error ? error.message : String(error)}`);
    }
    if (!this.mail.configured) return;
    try {
      const user = await this.prisma.user.findUnique({ where: { id: userId }, select: { name: true, email: true, preferredLanguage: true } });
      if (!user) return;
      const link = `${this.config.get<string>('USER_FRONTEND_URL') ?? 'http://localhost:3000'}/settings/security`;
      await this.mail.sendTwoStepNoticeEmail(user.email, user.preferredLanguage === 'BN' ? 'bn' : 'en', { kind, name: user.name, link });
    } catch (error) {
      this.logger.warn(`Two-step email for ${userId} failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  // ---- Housekeeping ----

  // Challenges a day past their end, trusted computers past theirs, and
  // set-ups abandoned for a day.
  async cleanup(now: Date): Promise<void> {
    const dayAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);
    await this.prisma.twoStepChallenge.deleteMany({ where: { expiresAt: { lt: dayAgo } } });
    await this.prisma.trustedDevice.deleteMany({ where: { expiresAt: { lt: now } } });
    await this.prisma.twoFactor.deleteMany({ where: { enabledAt: null, updatedAt: { lt: dayAgo } } });
  }

  // ---- Internals ----

  async requiredForAdmins(): Promise<boolean> {
    return (await this.settings.getCached()).adminTwoStepRequired === true;
  }

  private async confirmIdentity(userId: string, { password, sessionId }: Reauth): Promise<void> {
    if (await this.credentials.has(userId)) {
      if (!password || !(await this.credentials.verify(userId, password))) {
        throw new BadRequestException('Your password is incorrect.');
      }
      return;
    }
    // A Google-only account: a sign-in in the last ten minutes instead.
    const session = await this.sessions.findActive(sessionId);
    if (!session || Date.now() - session.createdAt.getTime() > RECENT_SIGN_IN_MS) {
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

  // A code from the app (each step once) or an unused backup code (used up
  // here). Null when neither matches.
  private async checkProof(userId: string, { code, backupCode }: TwoStepProof): Promise<{ backupCodesLeft: number | null } | null> {
    const factor = await this.prisma.twoFactor.findUnique({ where: { userId } });
    if (!factor?.enabledAt) return null;
    if (code) {
      const lastUsed = factor.lastUsedStep === null ? null : Number(factor.lastUsedStep);
      const step = matchTotp(this.open(factor.secretCiphertext), code, new Date(), lastUsed);
      if (step === null) return null;
      // Claim the step: two requests racing with one code both match, but
      // only one moves lastUsedStep past it.
      const { count } = await this.prisma.twoFactor.updateMany({
        where: { userId, OR: [{ lastUsedStep: null }, { lastUsedStep: { lt: BigInt(step) } }] },
        data: { lastUsedStep: BigInt(step) },
      });
      return count === 1 ? { backupCodesLeft: null } : null;
    }
    if (backupCode) {
      const normalized = normalizeBackupCode(backupCode);
      if (!normalized) return null;
      const { count } = await this.prisma.twoFactorBackupCode.updateMany({
        where: { userId, codeHash: hashBackupCode(this.pepper(), userId, normalized), usedAt: null },
        data: { usedAt: new Date() },
      });
      if (count !== 1) return null;
      return { backupCodesLeft: await this.prisma.twoFactorBackupCode.count({ where: { userId, usedAt: null } }) };
    }
    return null;
  }

  private async matchTrustedDevice(userId: string, header: string | string[] | undefined): Promise<boolean> {
    const tokens = parseTrustedTokens(header);
    if (tokens.length === 0) return false;
    const device = await this.prisma.trustedDevice.findFirst({
      where: { userId, tokenHash: { in: tokens.map(hashToken) }, expiresAt: { gt: new Date() } },
      select: { id: true },
    });
    if (!device) return false;
    await this.prisma.trustedDevice.update({ where: { id: device.id }, data: { lastUsedAt: new Date() } });
    return true;
  }

  private async issueChallenge(userId: string, purpose: TwoStepPurpose): Promise<{ token: string; expiresAt: Date }> {
    const ttl = purpose === 'SETUP' ? SETUP_TTL_MS : CHALLENGE_TTL_MS;
    const expiresAt = new Date(Date.now() + ttl);
    // One open challenge of a kind per account: a new sign-in replaces it.
    await this.prisma.twoStepChallenge.deleteMany({ where: { userId, purpose, consumedAt: null } });
    const row = await this.prisma.twoStepChallenge.create({ data: { userId, purpose, expiresAt } });
    const token = this.jwt.sign(
      { sub: userId, purpose },
      { secret: this.challengeSecret(), audience: CHALLENGE_AUDIENCE, jwtid: row.id, expiresIn: Math.floor(ttl / 1000) },
    );
    return { token, expiresAt };
  }

  private async openChallenge(token: string, purpose: TwoStepPurpose) {
    let claims: ChallengeClaims;
    try {
      claims = this.jwt.verify<ChallengeClaims>(token, { secret: this.challengeSecret(), audience: CHALLENGE_AUDIENCE });
    } catch {
      throw expired();
    }
    if (claims.purpose !== purpose || typeof claims.jti !== 'string' || typeof claims.sub !== 'string') throw expired();
    const row = await this.prisma.twoStepChallenge.findUnique({ where: { id: claims.jti } });
    if (!row || row.userId !== claims.sub || row.purpose !== purpose) throw expired();
    const problem = challengeProblem(row, new Date());
    if (problem) throw expired(problem);
    return row;
  }

  // Counts one try before the code is checked, so parallel guesses can't
  // get past five.
  private async countTry(id: string): Promise<void> {
    const { count } = await this.prisma.twoStepChallenge.updateMany({
      where: { id, consumedAt: null, attempts: { lt: MAX_CHALLENGE_ATTEMPTS }, expiresAt: { gt: new Date() } },
      data: { attempts: { increment: 1 } },
    });
    if (count === 0) throw expired('TOO_MANY_ATTEMPTS');
  }

  private async consume(id: string): Promise<void> {
    const { count } = await this.prisma.twoStepChallenge.updateMany({ where: { id, consumedAt: null }, data: { consumedAt: new Date() } });
    if (count === 0) throw expired();
  }

  private async recordFailure(userId: string, client: ClientInfo): Promise<void> {
    const user = await this.prisma.user.findUnique({ where: { id: userId }, select: { email: true } });
    if (!user) return;
    await this.prisma.loginAttempt.create({
      data: { email: user.email, ipAddress: client.ipAddress ?? 'unknown', userAgent: client.userAgent, success: false, failureReason: 'two_step_failed' },
    });
    this.alerts?.afterFailedTry(user.email, client);
  }

  private encryptionKey(): Buffer {
    return keyFromEnv(['TWO_FACTOR_ENCRYPTION_KEY', 'VAULT_ENCRYPTION_KEY']);
  }

  // The backup codes' HMAC key, derived from the encryption key.
  private pepper(): Buffer {
    return createHmac('sha256', this.encryptionKey()).update('two-step-backup-codes').digest();
  }

  // TWO_STEP_SECRET, or one derived from JWT_SECRET: the challenge tokens
  // never verify as access tokens on either side, and need no new setting.
  private challengeSecret(): string {
    const own = this.config.get<string>('TWO_STEP_SECRET');
    if (own) return own;
    return createHmac('sha256', this.config.getOrThrow<string>('JWT_SECRET')).update('two-step-challenge').digest('hex');
  }
}
