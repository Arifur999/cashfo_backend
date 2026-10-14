import { Injectable, UnauthorizedException } from '@nestjs/common';
import type { Role } from '@prisma/client';
import { AdminAuthService } from '../admin-auth/admin-auth.service.js';
import { AuthSessionsService, type ClientInfo } from '../auth/auth-sessions.service.js';
import { isAdminRole } from '../common/roles.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { LoginDto } from '../user-auth/dto/login.dto.js';
import { UserAuthService } from '../user-auth/user-auth.service.js';

export type SignInAudience = 'admin' | 'user';

export interface SignInResult {
  // Which side the tokens are for: admin tokens open /admin/*, user tokens
  // the end-user app. They are signed with different secrets.
  audience: SignInAudience;
  accessToken: string;
  refreshToken: string;
  account: { id: string; name: string; email: string; role: Role };
  // End users only: the workspace the app opens first.
  defaultBusinessId?: string;
}

// One sign-in for the whole site. The account's role decides which side
// signs it in -- AdminAuthService or UserAuthService, unchanged, with their
// own checks, login history and audit trail -- and so which tokens it gets.
@Injectable()
export class SignInService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly sessions: AuthSessionsService,
    private readonly adminAuth: AdminAuthService,
    private readonly userAuth: UserAuthService,
  ) {}

  async withPassword(dto: LoginDto, client: ClientInfo): Promise<SignInResult> {
    if (await this.isAdmin({ email: dto.email })) {
      const { accessToken, refreshToken, adminUser } = await this.adminAuth.login(dto, client);
      return { audience: 'admin', accessToken, refreshToken, account: adminUser };
    }
    // Unknown emails land here too: the end-user login records the attempt
    // and answers with the same generic "Invalid email or password".
    const { accessToken, refreshToken, user, defaultBusinessId } = await this.userAuth.login(dto, client);
    return { audience: 'user', accessToken, refreshToken, account: { id: user.id, name: user.name, email: user.email, role: 'USER' }, defaultBusinessId };
  }

  // The second half of Google sign-in, for everyone: the better-auth session
  // cookie its callback left behind, exchanged on the side the account
  // belongs to. A first Google sign-in by a new person is their signup.
  async withSession(cookieHeader: string | undefined, client: ClientInfo, referralCode?: string): Promise<SignInResult> {
    const signedIn = await this.sessions.fromCookie(cookieHeader);
    if (!signedIn) {
      throw new UnauthorizedException('No signed-in session to exchange');
    }
    if (await this.isAdmin({ id: signedIn.userId })) {
      const { accessToken, refreshToken, adminUser } = await this.adminAuth.exchangeSession(cookieHeader, client);
      return { audience: 'admin', accessToken, refreshToken, account: adminUser };
    }
    const { accessToken, refreshToken, user, defaultBusinessId } = await this.userAuth.exchangeSession(cookieHeader, client, referralCode);
    return { audience: 'user', accessToken, refreshToken, account: { id: user.id, name: user.name, email: user.email, role: 'USER' }, defaultBusinessId };
  }

  private async isAdmin(where: { email: string } | { id: string }): Promise<boolean> {
    const account = await this.prisma.user.findUnique({ where, select: { role: true } });
    return account !== null && isAdminRole(account.role);
  }
}
