import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { Request } from 'express';
import { RequestUser } from '../../user-auth/interfaces/request-user.interface.js';

interface VaultTokenPayload {
  sub: string;
  scope: string;
}

// Guards every /api/vault/entries* route on top of UserAuthGuard (which must
// run first and attach request.user) -- proves the caller unlocked the vault
// recently via POST /api/vault/unlock, not just that they're logged in. The
// token is short-lived (VAULT_TOKEN_EXPIRES_IN) and signed with its own
// secret so a stolen main access token alone can never reach vault entries.
@Injectable()
export class VaultAccessGuard implements CanActivate {
  constructor(
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
  ) {}

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<Request & { user?: RequestUser }>();
    const header = request.headers['x-vault-token'];
    const token = Array.isArray(header) ? header[0] : header;
    if (!token) {
      throw new UnauthorizedException('Vault is locked');
    }

    let payload: VaultTokenPayload;
    try {
      payload = this.jwtService.verify<VaultTokenPayload>(token, {
        secret: this.configService.get<string>('VAULT_TOKEN_SECRET'),
      });
    } catch {
      throw new UnauthorizedException('Vault session expired -- please unlock again');
    }

    if (payload.scope !== 'vault' || payload.sub !== request.user?.id) {
      throw new UnauthorizedException('Vault is locked');
    }
    return true;
  }
}
