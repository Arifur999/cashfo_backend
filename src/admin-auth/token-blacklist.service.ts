import { Injectable } from '@nestjs/common';

// In-memory refresh-token blacklist, keyed by the token's `jti` claim.
//
// WHY in-memory instead of a DB table: the Prisma schema for this prompt is
// intentionally limited to AdminUser/AuditLog/PlatformSetting, so this avoids
// adding a RefreshToken table just to support logout. It's a reasonable
// starting point because there is currently exactly one backend instance and
// a short session lifetime.
//
// LIMITATION (revisit later): this blacklist is lost on process restart and
// does not work across multiple backend instances/replicas. If the app is
// ever horizontally scaled, replace this with a Redis-backed blacklist (or
// switch to short-lived access tokens + refresh-token rotation stored in the
// database) instead of adding more in-memory state.
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
