import { createHash } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';

// The header a request carries the diary unlock in.
export const JOURNAL_UNLOCK_HEADER = 'x-journal-unlock';

// How long one correct diary PIN keeps private entries open on that sign-in.
export const JOURNAL_UNLOCK_TTL_SECONDS = 12 * 60 * 60;

// Its own audience, so an unlock is never accepted as an access token or a
// workspace unlock, and neither of those opens the diary.
const AUDIENCE = 'journal-unlock';

interface UnlockClaims {
  sub: string;
  sid: string;
  pv: string;
}

export interface JournalUnlock {
  unlockToken: string;
  expiresIn: number;
}

// Proof that the diary PIN was entered on this sign-in: a token naming the
// person, their session and the PIN it was entered against. Signing out
// ends it with the session, and a new PIN ends every unlock made with the
// old one.
@Injectable()
export class JournalUnlockService {
  constructor(
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
  ) {}

  issue(userId: string, sessionId: string, pinHash: string): JournalUnlock {
    const claims: UnlockClaims = { sub: userId, sid: sessionId, pv: pinVersion(pinHash) };
    const unlockToken = this.jwt.sign(claims, { secret: this.secret(), audience: AUDIENCE, expiresIn: JOURNAL_UNLOCK_TTL_SECONDS });
    return { unlockToken, expiresIn: JOURNAL_UNLOCK_TTL_SECONDS };
  }

  opens(token: string | undefined, userId: string, sessionId: string, pinHash: string | null): boolean {
    if (!token || !pinHash) return false;
    let claims: UnlockClaims;
    try {
      claims = this.jwt.verify<UnlockClaims>(token, { secret: this.secret(), audience: AUDIENCE });
    } catch {
      return false;
    }
    return claims.sub === userId && claims.sid === sessionId && claims.pv === pinVersion(pinHash);
  }

  private secret(): string {
    return this.config.getOrThrow<string>('USER_JWT_SECRET');
  }
}

// bcrypt salts every hash, so even the same PIN set again gets a new version.
const pinVersion = (pinHash: string) => createHash('sha256').update(pinHash).digest('hex').slice(0, 16);
