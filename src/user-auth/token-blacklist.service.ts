import { Injectable } from '@nestjs/common';

// In-memory refresh-token blacklist for end users, keyed by the token's
// `jti` claim. Module-private (mirrors admin-auth's own TokenBlacklistService)
// rather than shared, so this auth domain doesn't depend on an internal
// admin module.
//
// Same limitation as admin-auth's: lost on process restart, doesn't work
// across multiple backend instances -- revisit with a Redis-backed blacklist
// if this is ever horizontally scaled.
@Injectable()
export class TokenBlacklistService {
  private readonly revokedUntil = new Map<string, number>(); // jti -> exp (unix seconds)

  revoke(jti: string, expiresAtSeconds?: number) {
    const fallbackExpiry = Math.floor(Date.now() / 1000) + 7 * 24 * 60 * 60;
    this.revokedUntil.set(jti, expiresAtSeconds ?? fallbackExpiry);
    this.cleanupExpired();
  }

  isRevoked(jti: string | undefined): boolean {
    if (!jti) return false;
    return this.revokedUntil.has(jti);
  }

  private cleanupExpired() {
    const now = Math.floor(Date.now() / 1000);
    for (const [jti, exp] of this.revokedUntil) {
      if (exp < now) this.revokedUntil.delete(jti);
    }
  }
}
