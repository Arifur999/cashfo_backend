import { createHash } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';

// The header a PIN-locked workspace's requests carry the unlock in.
export const WORKSPACE_UNLOCK_HEADER = 'x-workspace-unlock';

// How long one correct PIN keeps a workspace open on that device.
export const WORKSPACE_UNLOCK_TTL_SECONDS = 12 * 60 * 60;

// Its own audience, so an unlock is never accepted as an access token (they
// verify with audience "user") and an access token never opens a workspace.
const AUDIENCE = 'workspace-unlock';

interface UnlockClaims {
  sub: string;
  sid: string;
  bid: string;
  pv: string;
}

export interface WorkspaceUnlock {
  unlockToken: string;
  expiresIn: number;
}

// Proof that the PIN of a locked workspace was entered on this device: a
// token naming the user, their session, the workspace and the PIN it was
// entered against. Signing out ends it with the session, and a new PIN
// ends every unlock made with the old one.
@Injectable()
export class WorkspaceUnlockService {
  constructor(
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
  ) {}

  issue(userId: string, sessionId: string, businessId: string, pinHash: string): WorkspaceUnlock {
    const claims: UnlockClaims = { sub: userId, sid: sessionId, bid: businessId, pv: pinVersion(pinHash) };
    const unlockToken = this.jwt.sign(claims, { secret: this.secret(), audience: AUDIENCE, expiresIn: WORKSPACE_UNLOCK_TTL_SECONDS });
    return { unlockToken, expiresIn: WORKSPACE_UNLOCK_TTL_SECONDS };
  }

  opens(token: string | undefined, userId: string, sessionId: string, businessId: string, pinHash: string): boolean {
    if (!token) return false;
    let claims: UnlockClaims;
    try {
      claims = this.jwt.verify<UnlockClaims>(token, { secret: this.secret(), audience: AUDIENCE });
    } catch {
      return false;
    }
    return claims.sub === userId && claims.sid === sessionId && claims.bid === businessId && claims.pv === pinVersion(pinHash);
  }

  private secret(): string {
    return this.config.getOrThrow<string>('USER_JWT_SECRET');
  }
}

// bcrypt salts every hash, so even the same PIN set again gets a new version.
const pinVersion = (pinHash: string) => createHash('sha256').update(pinHash).digest('hex').slice(0, 16);
