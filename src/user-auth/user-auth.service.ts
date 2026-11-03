import { BadRequestException, ConflictException, ForbiddenException, Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Role, type User } from '@prisma/client';
import { createHash, randomBytes } from 'crypto';
import { AccountDeletionService } from '../account-deletion/account-deletion.service.js';
import { isPurgeDue, isRestorable } from '../account-deletion/deletion-rules.js';
import { AuthSessionsService, type ClientInfo } from '../auth/auth-sessions.service.js';
import { CredentialsService } from '../auth/credentials.service.js';
import { SessionTokensService } from '../auth/session-tokens.service.js';
import { MailService } from '../mail/mail.service.js';
import { CODE_MESSAGES } from '../one-time-codes/one-time-codes.js';
import { OneTimeCodesService, type Challenge } from '../one-time-codes/one-time-codes.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { areSignupsOpen, SIGNUPS_CLOSED_MESSAGE, SIGNUPS_CLOSED_REASON } from '../settings/signups.js';
import { TwoStepService } from '../two-step/two-step.service.js';
import { ChangePasswordDto } from './dto/change-password.dto.js';
import { LoginDto } from './dto/login.dto.js';
import { RegisterDto } from './dto/register.dto.js';
import { SecurityAlertsService } from './security-alerts.service.js';
import { UserProvisioningService, type ProvisionOptions } from './user-provisioning.service.js';
import { UserSessionsService } from './user-sessions.service.js';

const INVALID_RESET_LINK = 'This reset link is invalid or has expired. Please request a new one.';

// A refusal the reset page can act on by its reason.
const resetRefusal = (reason: string, message: string, extra: Record<string, unknown> = {}) =>
  new BadRequestException({ statusCode: 400, error: 'Bad Request', message, reason, ...extra });

// What the emailed code confirms, worded for the code email.
const RESET_CODE_ACTION = { en: 'reset your password', bn: 'পাসওয়ার্ড রিসেট' };

// "Ask for a code before a password reset": the emailed code that goes
// with the link (Settings > Security > Alerts).
export interface ResetCodeProof {
  challengeId?: string;
  code?: string;
}

@Injectable()
export class UserAuthService {
  private readonly logger = new Logger(UserAuthService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly configService: ConfigService,
    private readonly mailService: MailService,
    private readonly credentials: CredentialsService,
    private readonly sessions: AuthSessionsService,
    private readonly tokens: SessionTokensService,
    private readonly devices: UserSessionsService,
    private readonly provisioning: UserProvisioningService,
    private readonly twoStep: TwoStepService,
    private readonly deletion: AccountDeletionService,
    private readonly codes: OneTimeCodesService,
    private readonly alerts: SecurityAlertsService,
  ) {}

  // An account that may still sign in: active, or waiting out the 30 days
  // after "Delete my account" (signing in restores it).
  canSignIn(user: Pick<User, 'status' | 'deletionScheduledFor'>, now = new Date()): boolean {
    return user.status === 'ACTIVE' || isRestorable(user, now);
  }

  async register(dto: RegisterDto, client: ClientInfo) {
    // Settings "Allow new sign-ups" off: refuse before anything is created.
    if (!(await areSignupsOpen(this.prisma))) {
      throw new ForbiddenException({ statusCode: 403, error: 'Forbidden', message: SIGNUPS_CLOSED_MESSAGE, reason: SIGNUPS_CLOSED_REASON });
    }
    const existing = await this.prisma.user.findUnique({ where: { email: dto.email } });
    if (existing) {
      throw new ConflictException('An account with this email already exists');
    }

    // better-auth creates the account and its credential, then signs it in.
    // emailVerifiedAt stays null until the link from the verification email
    // (sent after the first sign-in, SecurityAlertsService) is opened.
    const signedIn = await this.sessions.signUpWithPassword(
      { name: dto.name, email: dto.email, password: dto.password, phone: dto.phone, preferredLanguage: dto.preferredLanguage },
      client,
    );
    if (!signedIn) {
      throw new ConflictException('An account with this email already exists');
    }

    const defaultBusinessId = await this.provisioning.ensureDefaultWorkspace(signedIn.userId, { referralCode: dto.referralCode, referralSource: dto.referralSource });
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: signedIn.userId } });
    return this.signedInResponse(user, signedIn.sessionId, client, defaultBusinessId);
  }

  // trustedDevices: the x-trusted-device header the frontend forwards from
  // its cookies, which lets a computer trusted for 30 days skip the code.
  async login(dto: LoginDto, client: ClientInfo, trustedDevices?: string | string[]) {
    const user = await this.prisma.user.findUnique({ where: { email: dto.email } });

    // DELETED is treated the same as "no account" -- a soft-deleted account
    // shouldn't reveal its own existence any more than a nonexistent email
    // would -- and so is an admin account, which signs in on the admin side.
    // SUSPENDED gets a distinct, honest message (spec's explicit completion
    // criterion): the owner should know the account is theirs and how to
    // resolve it.
    if (!user || user.status === 'DELETED' || user.role !== Role.USER) {
      await this.recordLoginAttempt(dto.email, client, false, 'account_not_found');
      throw new UnauthorizedException('Invalid email or password');
    }
    // Deleted and its 30 days are up: purge it now, then answer as if it
    // never existed. Inside the 30 days the sign-in goes on and restores it
    // (finishSignIn), only once the password -- and the code -- check out.
    if (isPurgeDue(user, new Date())) {
      await this.deletion.purge(user.id);
      await this.recordLoginAttempt(dto.email, client, false, 'account_not_found');
      throw new UnauthorizedException('Invalid email or password');
    }
    if (user.status === 'SUSPENDED') {
      await this.recordLoginAttempt(dto.email, client, false, 'account_suspended');
      throw new ForbiddenException('Your account has been suspended. Contact support for assistance.');
    }

    const signedIn = await this.sessions.signInWithPassword(dto.email, dto.password, client);
    if (!signedIn) {
      await this.recordLoginAttempt(dto.email, client, false, 'invalid_password');
      // "Warn me about unusual sign-in tries". Not awaited: the answer must
      // stay the same, and as quick, as for an email with no account.
      this.alerts.afterFailedTry(dto.email, client);
      throw new UnauthorizedException('Invalid email or password');
    }

    // Two-step sign-in: the code comes before any token.
    const pending = await this.twoStep.gate(user, signedIn.sessionId, 'user', trustedDevices);
    if (pending) return pending;
    return this.finishSignIn(user, signedIn.sessionId, client);
  }

  // Google sign-in ends on better-auth's callback, which leaves a session
  // cookie in the browser. The frontend forwards that cookie here and gets
  // the usual token pair, bound to that same session. An admin's session is
  // refused, not ended, so the frontend can exchange it on the admin side.
  async exchangeSession(cookieHeader: string | undefined, client: ClientInfo, referral?: ProvisionOptions, trustedDevices?: string | string[]) {
    const signedIn = await this.sessions.fromCookie(cookieHeader);
    if (!signedIn) {
      throw new UnauthorizedException('No signed-in session to exchange');
    }
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: signedIn.userId } });
    if (user.role !== Role.USER) {
      throw new ForbiddenException('This account signs in to the admin panel');
    }
    if (isPurgeDue(user, new Date())) {
      await this.sessions.revoke(signedIn.sessionId);
      await this.deletion.purge(user.id);
      throw new UnauthorizedException('No signed-in session to exchange');
    }
    if (!this.canSignIn(user)) {
      throw new ForbiddenException('Your account has been suspended. Contact support for assistance.');
    }

    const pending = await this.twoStep.gate(user, signedIn.sessionId, 'user', trustedDevices);
    if (pending) return pending;
    // A first Google sign-in is also the signup: finishing it creates the
    // workspace and records the referral the invite link carried.
    return this.finishSignIn(user, signedIn.sessionId, client, referral);
  }

  // Shared by every completed sign-in (password, Google, the second step):
  // stamps it, writes the login history, makes sure the account has its
  // workspace, and issues the tokens.
  async finishSignIn(user: User, sessionId: string, client: ClientInfo, referral?: ProvisionOptions) {
    // A sign-in inside the 30 days after "Delete my account" restores the
    // account; one after them purges it and is refused.
    const { restored } = await this.deletion.restoreOnSignIn(user);
    await this.prisma.$transaction([
      this.prisma.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } }),
      this.prisma.loginAttempt.create({
        data: { email: user.email, ipAddress: client.ipAddress ?? 'unknown', userAgent: client.userAgent, success: true },
      }),
    ]);
    // Also completes an account created elsewhere that has no workspace yet.
    const defaultBusinessId = await this.provisioning.ensureDefaultWorkspace(user.id, referral);
    return this.signedInResponse(user, sessionId, client, defaultBusinessId, restored);
  }

  // Shared by register/login/resetPassword: records the device for Device
  // Management and issues the token pair bound to its session.
  // restoredFromDeletion: this sign-in brought back an account that was
  // waiting to be deleted, so the app can say so.
  private async signedInResponse(user: User, sessionId: string, client: ClientInfo, defaultBusinessId: string, restoredFromDeletion = false) {
    await this.devices.record(user.id, sessionId, client);
    return {
      ...this.tokens.issue('user', { sub: user.id, sid: sessionId, role: user.role }),
      user: { id: user.id, name: user.name, email: user.email, preferredLanguage: user.preferredLanguage },
      defaultBusinessId,
      ...(restoredFromDeletion && { restoredFromDeletion: true }),
    };
  }

  private async recordLoginAttempt(email: string, client: ClientInfo, success: boolean, failureReason: string) {
    await this.prisma.loginAttempt.create({
      data: { email, ipAddress: client.ipAddress ?? 'unknown', userAgent: client.userAgent, success, failureReason },
    });
  }

  // A new access token for as long as the device's session lives -- logout,
  // revoking the device, a suspension or a password reset ends it.
  async refresh(refreshToken: string) {
    const { sub, sid } = this.tokens.verifyRefresh('user', refreshToken);

    const session = await this.sessions.findActive(sid);
    if (!session || session.userId !== sub) {
      throw new UnauthorizedException('This session has been signed out');
    }
    if (session.user.status !== 'ACTIVE' || session.user.role !== Role.USER) {
      throw new UnauthorizedException('Account no longer active');
    }

    await this.devices.touch(sid);
    return { accessToken: this.tokens.signAccess('user', { sub, sid, role: session.user.role }) };
  }

  // `everywhere` ends every device of the account, but only from a live
  // session of the customer's own: a stale token, or a super admin's
  // read-only view, signs out just itself.
  async logout(refreshToken: string, everywhere = false) {
    // Best-effort: an already-expired or malformed refresh token has no
    // session left to end, so don't fail the logout request over it.
    try {
      const { sub, sid } = this.tokens.verifyRefresh('user', refreshToken);
      const session = everywhere ? await this.sessions.findActive(sid) : null;
      if (session && session.userId === sub && !session.impersonatedBy) {
        await this.devices.endAll(sub);
      } else {
        await this.devices.end(sid);
      }
    } catch {
      // ignore
    }
    return { success: true };
  }

  // Signs every other device out unless the customer unticks it: changing
  // the password is what someone does when they think the account was taken
  // over, and the old sessions would otherwise keep working until they
  // expire.
  async changePassword(userId: string, sessionId: string, dto: ChangePasswordDto) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) {
      throw new UnauthorizedException('Account no longer exists');
    }

    const currentMatches = await this.credentials.verify(userId, dto.currentPassword);
    if (!currentMatches) {
      throw new BadRequestException('Current password is incorrect');
    }

    await this.credentials.set(userId, dto.newPassword);
    if (dto.signOutOthers !== false) await this.devices.endAllExcept(userId, sessionId);
    return { success: true };
  }

  // "Forgot password?" on the login page. Always resolves to the same
  // generic {success: true} regardless of whether the email matched a real,
  // ACTIVE end-user account -- same "don't reveal account existence"
  // instinct as login()'s identical invalid-email/invalid-password message.
  // Admin passwords are reset by a super admin, never by email link.
  async forgotPassword(email: string): Promise<{ success: true }> {
    const user = await this.prisma.user.findUnique({ where: { email } });

    // An account waiting to be deleted may reset too: a forgotten password
    // must not cost the owner their account. The reset restores it.
    if (user && this.canSignIn(user) && user.role === Role.USER) {
      const rawToken = await this.createResetToken(user.id);
      const frontendUrl = this.configService.get<string>('USER_FRONTEND_URL') ?? 'http://localhost:3001';
      const resetUrl = `${frontendUrl}/reset-password?token=${rawToken}`;
      try {
        await this.mailService.sendPasswordResetEmail(user.email, user.name, resetUrl);
      } catch (err: unknown) {
        // Unlike the welcome email, this one isn't fire-and-forget -- but a
        // send failure still must not change the generic response below, or
        // it becomes an account-existence oracle (fails only for real emails).
        this.logger.error(`Failed to send password reset email to ${user.email}: ${err instanceof Error ? err.message : String(err)}`);
      }
    }

    return { success: true };
  }

  // A fresh 30-minute reset token for this account, superseding any still
  // outstanding; the raw token goes in the link. codeProven: an SMS code to
  // the verified phone already proved it (PhoneService), so no second code.
  async createResetToken(userId: string, { codeProven = false } = {}): Promise<string> {
    const rawToken = randomBytes(32).toString('hex');
    // sha256, not bcrypt -- the token already carries 256 bits of its own
    // entropy (unlike a human password), so a deterministic hash is fine
    // and lets resetPassword() below look it up with a plain unique query
    // instead of bcrypt.compare-ing against every unexpired row.
    const tokenHash = createHash('sha256').update(rawToken).digest('hex');
    const expiresAt = new Date(Date.now() + 30 * 60 * 1000);
    await this.prisma.$transaction([
      // Only the newest link should ever work -- supersede anything still
      // outstanding for this user rather than leaving multiple valid ones.
      this.prisma.passwordResetToken.updateMany({ where: { userId, usedAt: null }, data: { usedAt: new Date() } }),
      this.prisma.passwordResetToken.create({ data: { userId, tokenHash, expiresAt, codeProven } }),
    ]);
    return rawToken;
  }

  // The link from forgotPassword()'s email. Consuming it signs the account
  // out on every device -- changing your password signs you out everywhere
  // else -- then signs the caller in fresh, same response shape as
  // login()/register(), so the frontend can set cookies and go straight on.
  // Whether a reset link still works, without using it, so the reset page
  // can say an expired or used link up front instead of after the new
  // password is typed twice. The same rules as resetPassword(); only a
  // yes or no comes back, and whether the page must ask for the emailed
  // code too (codeRequired).
  async checkResetToken(rawToken: string): Promise<{ valid: boolean; codeRequired: boolean }> {
    const tokenHash = createHash('sha256').update(rawToken).digest('hex');
    const resetToken = await this.prisma.passwordResetToken.findUnique({ where: { tokenHash }, select: { usedAt: true, expiresAt: true, userId: true, codeProven: true } });
    if (!resetToken || resetToken.usedAt || resetToken.expiresAt < new Date()) return { valid: false, codeRequired: false };
    const owner = await this.prisma.user.findUnique({
      where: { id: resetToken.userId },
      select: { status: true, role: true, deletionScheduledFor: true, askCodeBeforeReset: true },
    });
    const valid = !!owner && this.canSignIn(owner) && owner.role === Role.USER;
    return { valid, codeRequired: valid && owner.askCodeBeforeReset && !resetToken.codeProven };
  }

  // "Ask for a code before a password reset" is on: the link alone isn't
  // enough, a six-digit code goes to the account's email too. The code is
  // bound to this link (payload.resetTokenId).
  async sendResetCode(rawToken: string): Promise<Challenge> {
    const { resetToken, owner } = await this.openResetLink(rawToken);
    if (!owner.askCodeBeforeReset || resetToken.codeProven) throw resetRefusal('CODE_NOT_REQUIRED', 'This reset link does not need a code.');
    return this.codes.issue(owner, 'PASSWORD_RESET', { resetTokenId: resetToken.id }, RESET_CODE_ACTION);
  }

  async resendResetCode(rawToken: string, challengeId: string): Promise<Challenge> {
    const { resetToken, owner } = await this.openResetLink(rawToken);
    const row = await this.prisma.oneTimeCode.findFirst({ where: { id: challengeId, userId: owner.id, purpose: 'PASSWORD_RESET' }, select: { payload: true } });
    if (row && resetTokenIdOf(row.payload) !== resetToken.id) throw resetRefusal('CODE_EXPIRED', CODE_MESSAGES.CODE_EXPIRED);
    return this.codes.resend(owner, challengeId, 'PASSWORD_RESET', RESET_CODE_ACTION);
  }

  // A reset link that still works, and its owner: the same rules as
  // checkResetToken(), refused with reason LINK_INVALID.
  private async openResetLink(rawToken: string) {
    const tokenHash = createHash('sha256').update(rawToken).digest('hex');
    const resetToken = await this.prisma.passwordResetToken.findUnique({ where: { tokenHash } });
    if (!resetToken || resetToken.usedAt || resetToken.expiresAt < new Date()) throw resetRefusal('LINK_INVALID', INVALID_RESET_LINK);
    const owner = await this.prisma.user.findUnique({ where: { id: resetToken.userId } });
    if (!owner || !this.canSignIn(owner) || owner.role !== Role.USER) throw resetRefusal('LINK_INVALID', INVALID_RESET_LINK);
    return { resetToken, owner };
  }

  // When the owner asks for a code before a reset: checks the typed one
  // (the try counts) and that it was sent for this very link. Returns the
  // code's id, to use up with the link, or null when no code is needed.
  private async checkResetCode(resetToken: { id: string; userId: string; codeProven: boolean }, proof: ResetCodeProof): Promise<string | null> {
    if (resetToken.codeProven) return null;
    const owner = await this.prisma.user.findUnique({ where: { id: resetToken.userId }, select: { askCodeBeforeReset: true } });
    if (!owner?.askCodeBeforeReset) return null;
    if (!proof.challengeId || !proof.code) throw resetRefusal('CODE_REQUIRED', 'Enter the code we emailed you to reset your password.');
    const row = await this.codes.verify(resetToken.userId, proof.challengeId, 'PASSWORD_RESET', proof.code);
    if (resetTokenIdOf(row.payload) !== resetToken.id) throw resetRefusal('CODE_EXPIRED', CODE_MESSAGES.CODE_EXPIRED);
    return row.id;
  }

  async resetPassword(rawToken: string, newPassword: string, client: ClientInfo, proof: ResetCodeProof = {}) {
    const tokenHash = createHash('sha256').update(rawToken).digest('hex');
    const resetToken = await this.prisma.passwordResetToken.findUnique({ where: { tokenHash } });
    if (!resetToken || resetToken.usedAt || resetToken.expiresAt < new Date()) {
      throw new BadRequestException(INVALID_RESET_LINK);
    }
    // Checked before the link is claimed below, so a wrong code doesn't
    // use the link up.
    const codeId = await this.checkResetCode(resetToken, proof);

    const user = await this.prisma.$transaction(async (tx) => {
      // Claim the token first, conditionally: two requests racing with the
      // same link both pass the read above, but only one can flip usedAt
      // from null -- the other gets count 0 and is refused, so a link really
      // is single-use.
      const now = new Date();
      const { count } = await tx.passwordResetToken.updateMany({
        where: { id: resetToken.id, usedAt: null, expiresAt: { gt: now } },
        data: { usedAt: now },
      });
      if (count !== 1) {
        throw new BadRequestException(INVALID_RESET_LINK);
      }
      // A link mailed while the account was active must not work after it has
      // been suspended or deleted -- that would both change the password and
      // log the user in, bypassing login()'s status checks. Same generic
      // message, so the link doesn't reveal the account's status.
      const owner = await tx.user.findUnique({ where: { id: resetToken.userId } });
      if (!owner || !this.canSignIn(owner) || owner.role !== Role.USER) {
        throw new BadRequestException(INVALID_RESET_LINK);
      }
      // The code goes with the link: a double submit uses it once.
      if (codeId && !(await this.codes.consume(tx, codeId))) throw resetRefusal('CODE_USED', CODE_MESSAGES.CODE_USED);
      await this.credentials.set(owner.id, newPassword, tx);
      // A link from the email proves the address is the owner's. A phone
      // verified before that may be someone else's -- whoever signed up with
      // this address first -- and could reset the password again, so it goes.
      if (!resetToken.codeProven) await tx.user.update({ where: { id: owner.id }, data: emailProvenBy(owner, now) });
      return owner;
    });

    await this.devices.endAll(user.id);
    const sessionId = await this.sessions.create(user.id, client);
    // With two-step on, the new password alone doesn't sign in: the reset
    // ended every trusted computer, so the code is asked for.
    const pending = await this.twoStep.gate(user, sessionId, 'user');
    if (pending) return pending;
    const { restored } = await this.deletion.restoreOnSignIn(user);
    const defaultBusinessId = await this.provisioning.ensureDefaultWorkspace(user.id);
    return this.signedInResponse(user, sessionId, client, defaultBusinessId, restored);
  }
}

// What an email-link reset changes beside the password: the email is
// verified, and a phone verified before the email was is taken off.
export function emailProvenBy(owner: { emailVerifiedAt: Date | null; phoneVerifiedAt: Date | null }, now: Date) {
  const phoneBeforeEmail = !!owner.phoneVerifiedAt && (!owner.emailVerifiedAt || owner.phoneVerifiedAt < owner.emailVerifiedAt);
  return { emailVerified: true, emailVerifiedAt: owner.emailVerifiedAt ?? now, ...(phoneBeforeEmail && { phone: null, phoneVerifiedAt: null }) };
}

// The reset link a password-reset code was sent for.
function resetTokenIdOf(payload: unknown): string | null {
  const value = payload && typeof payload === 'object' ? (payload as { resetTokenId?: unknown }).resetTokenId : null;
  return typeof value === 'string' ? value : null;
}
