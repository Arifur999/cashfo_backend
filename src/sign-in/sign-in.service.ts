import { BadRequestException, Injectable, UnauthorizedException } from '@nestjs/common';
import type { Role, StartPage, User } from '@prisma/client';
import { AdminAuthService } from '../admin-auth/admin-auth.service.js';
import { AuthSessionsService, type ClientInfo } from '../auth/auth-sessions.service.js';
import { isAdminRole } from '../common/roles.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { isTwoStepPending, TwoStepService, type TwoStepPending } from '../two-step/two-step.service.js';
import { LoginDto } from '../user-auth/dto/login.dto.js';
import { canonicalPhone } from '../user-auth/phone.service.js';
import { UserAuthService } from '../user-auth/user-auth.service.js';
import type { ProvisionOptions } from '../user-auth/user-provisioning.service.js';
import type { SignInDto } from './sign-in.dto.js';
import type { TwoStepSignInDto } from './two-step-sign-in.dto.js';

export type SignInAudience = 'admin' | 'user';

export interface SignInResult {
  // Which side the tokens are for: admin tokens open /admin/*, user tokens
  // the end-user app. They are signed with different secrets.
  audience: SignInAudience;
  accessToken: string;
  refreshToken: string;
  account: { id: string; name: string; email: string; role: Role; startPage?: StartPage };
  // End users only: the workspace the app opens first.
  defaultBusinessId?: string;
  // End users only: this sign-in restored an account that was waiting out
  // the 30 days after "Delete my account".
  restoredFromDeletion?: boolean;
}

// The second step finished: the usual result, plus the 30-day token when
// the computer was trusted (the frontend keeps it in an httpOnly cookie,
// trustedDevice_<account id>) and, after a backup code, how many are left.
export interface TwoStepSignInResult extends SignInResult {
  trustedDeviceToken?: string;
  trustedDeviceExpiresAt?: Date;
  backupCodesLeft?: number;
}

type AdminSignedIn = { accessToken: string; refreshToken: string; adminUser: SignInResult['account'] };
type UserSignedIn = {
  accessToken: string;
  refreshToken: string;
  user: { id: string; name: string; email: string };
  defaultBusinessId: string;
  restoredFromDeletion?: boolean;
};

// One sign-in for the whole site. The account's role decides which side
// signs it in -- AdminAuthService or UserAuthService, unchanged, with their
// own checks, login history and audit trail -- and so which tokens it gets.
// With two-step sign-in on (and the computer not trusted) either side
// answers with the pending step instead of tokens: {twoStepRequired,
// challengeToken, ...}, or for an admin who must set it up first
// {twoStepSetupRequired, setupToken, ...}.
@Injectable()
export class SignInService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly sessions: AuthSessionsService,
    private readonly adminAuth: AdminAuthService,
    private readonly userAuth: UserAuthService,
    private readonly twoStep: TwoStepService,
  ) {}

  // trustedDevices: the x-trusted-device header (the frontend forwards its
  // trustedDevice_* cookies there on sign-in calls).
  async withPassword(form: SignInDto, client: ClientInfo, trustedDevices?: string | string[]): Promise<SignInResult | TwoStepPending> {
    const dto: LoginDto = { email: await this.emailOf(form.email), password: form.password };
    if (await this.isAdmin({ email: dto.email })) {
      return this.adminResult(await this.adminAuth.login(dto, client, trustedDevices));
    }
    // Unknown emails land here too: the end-user login records the attempt
    // and answers with the same generic "Invalid email or password".
    return this.userResult(await this.userAuth.login(dto, client, trustedDevices));
  }

  // The second half of Google sign-in, for everyone: the better-auth session
  // cookie its callback left behind, exchanged on the side the account
  // belongs to. A first Google sign-in by a new person is their signup.
  async withSession(
    cookieHeader: string | undefined,
    client: ClientInfo,
    referral?: ProvisionOptions,
    trustedDevices?: string | string[],
  ): Promise<SignInResult | TwoStepPending> {
    const signedIn = await this.sessions.fromCookie(cookieHeader);
    if (!signedIn) {
      throw new UnauthorizedException('No signed-in session to exchange');
    }
    if (await this.isAdmin({ id: signedIn.userId })) {
      return this.adminResult(await this.adminAuth.exchangeSession(cookieHeader, client, trustedDevices));
    }
    return this.userResult(await this.userAuth.exchangeSession(cookieHeader, client, referral, trustedDevices));
  }

  // The second step, for both sides: a code (or backup code) for the
  // challenge the first step handed out. The session is opened only now.
  async withTwoStep(dto: TwoStepSignInDto, client: ClientInfo): Promise<TwoStepSignInResult> {
    if (Boolean(dto.code) === Boolean(dto.backupCode)) {
      throw new BadRequestException('Send either the code from your authenticator app or a backup code');
    }
    const { userId, backupCodesLeft } = await this.twoStep.answerChallenge(dto.challengeToken, { code: dto.code, backupCode: dto.backupCode }, client);
    const account = await this.prisma.user.findUnique({ where: { id: userId } });
    // A customer waiting out the 30 days after "Delete my account" may
    // finish signing in; finish() restores the account (or purges it, and
    // refuses, if its day has passed).
    const pendingDeletion = account?.status === 'PENDING_DELETION' && account.role === 'USER';
    if (!account || (account.status !== 'ACTIVE' && !pendingDeletion)) {
      throw new UnauthorizedException('This account is not active');
    }
    const sessionId = await this.sessions.create(userId, client);
    const result = await this.finish(account, sessionId, client);
    const trusted = dto.trustDevice ? await this.twoStep.trustDevice(userId, client) : null;
    return {
      ...result,
      ...(trusted && { trustedDeviceToken: trusted.token, trustedDeviceExpiresAt: trusted.expiresAt }),
      ...(backupCodesLeft !== null && { backupCodesLeft }),
    };
  }

  // Signs an account in on its side, on a session it already has (the
  // second step, an admin who just finished setting two-step up).
  async finish(account: User, sessionId: string, client: ClientInfo): Promise<SignInResult> {
    if (isAdminRole(account.role)) {
      return this.adminResult(await this.adminAuth.finishSignIn(account, sessionId, client)) as SignInResult;
    }
    return (await this.userResult(await this.userAuth.finishSignIn(account, sessionId, client))) as SignInResult;
  }

  private adminResult(result: TwoStepPending | AdminSignedIn): SignInResult | TwoStepPending {
    if (isTwoStepPending(result)) return result;
    const { accessToken, refreshToken, adminUser } = result;
    return { audience: 'admin', accessToken, refreshToken, account: adminUser };
  }

  private async userResult(result: TwoStepPending | UserSignedIn): Promise<SignInResult | TwoStepPending> {
    if (isTwoStepPending(result)) return result;
    const { accessToken, refreshToken, user, defaultBusinessId, restoredFromDeletion } = result;
    // Where the app opens (Settings › App preferences › First page).
    const start = await this.prisma.user.findUnique({ where: { id: user.id }, select: { startPage: true } });
    return {
      audience: 'user',
      accessToken,
      refreshToken,
      account: { id: user.id, name: user.name, email: user.email, role: 'USER', startPage: start?.startPage ?? 'DASHBOARD' },
      defaultBusinessId,
      ...(restoredFromDeletion && { restoredFromDeletion: true }),
    };
  }

  // The email an identifier stands for: an email as typed; a username (a
  // group member's login); or a mobile number, when exactly one group
  // member's login has it. Anything else goes on as typed and fails like an
  // unknown email, with the same answer, so nothing says which logins exist.
  private async emailOf(identifier: string): Promise<string> {
    if (identifier.includes('@')) return identifier;
    const phone = canonicalPhone(identifier);
    if (phone) {
      const logins = await this.prisma.user.findMany({ where: { phone, portalOnly: true }, select: { email: true }, take: 2 });
      return logins.length === 1 ? logins[0].email : identifier;
    }
    const login = await this.prisma.user.findUnique({ where: { username: identifier }, select: { email: true } });
    return login?.email ?? identifier;
  }

  private async isAdmin(where: { email: string } | { id: string }): Promise<boolean> {
    const account = await this.prisma.user.findUnique({ where, select: { role: true } });
    return account !== null && isAdminRole(account.role);
  }
}
