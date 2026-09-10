import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { Request } from 'express';
import { PrismaService } from '../../prisma/prisma.service.js';
import { RequestUser } from '../interfaces/request-user.interface.js';

interface AccessTokenPayload {
  sub: string;
}

// Verifies the end-user access token and attaches `request.user`. Uses
// USER_JWT_SECRET -- a separate secret from admin-auth's JWT_SECRET, so an
// admin access token can never be replayed against end-user routes, or
// vice versa. Mirrors AdminAuthGuard's shape exactly.
@Injectable()
export class UserAuthGuard implements CanActivate {
  constructor(
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
    private readonly prisma: PrismaService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<Request & { user?: RequestUser }>();
    const token = this.extractToken(request);
    if (!token) {
      throw new UnauthorizedException('Access token missing');
    }

    let payload: AccessTokenPayload;
    try {
      payload = this.jwtService.verify<AccessTokenPayload>(token, {
        secret: this.configService.get<string>('USER_JWT_SECRET'),
      });
    } catch {
      throw new UnauthorizedException('Invalid or expired access token');
    }

    const user = await this.prisma.user.findUnique({ where: { id: payload.sub } });
    if (!user) {
      throw new UnauthorizedException('Account no longer exists');
    }
    if (user.status !== 'ACTIVE') {
      throw new UnauthorizedException('This account is not active');
    }

    request.user = { id: user.id, email: user.email };
    return true;
  }

  // Prefer the Authorization header (the frontend forwards its httpOnly-
  // cookie-stored token this way), fall back to a same-origin cookie.
  private extractToken(request: Request): string | undefined {
    const authHeader = request.headers.authorization;
    if (authHeader?.startsWith('Bearer ')) {
      return authHeader.slice('Bearer '.length);
    }
    return (request as Request & { cookies?: Record<string, string> }).cookies?.accessToken;
  }
}
