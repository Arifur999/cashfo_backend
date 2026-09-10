import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { Request } from 'express';
import { PrismaService } from '../../prisma/prisma.service.js';
import { RequestPlatformUser } from '../interfaces/request-platform-user.interface.js';

interface AccessTokenPayload {
  sub: string;
}

// Verifies the platform-user access token and attaches `request.platformUser`.
// Uses PLATFORM_JWT_SECRET -- a separate secret from admin-auth's JWT_SECRET,
// so an admin access token can never be replayed against end-user routes (or
// vice versa).
@Injectable()
export class PlatformAuthGuard implements CanActivate {
  constructor(
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
    private readonly prisma: PrismaService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<Request & { platformUser?: RequestPlatformUser }>();
    const token = this.extractToken(request);
    if (!token) {
      throw new UnauthorizedException('Access token missing');
    }

    let payload: AccessTokenPayload;
    try {
      payload = this.jwtService.verify<AccessTokenPayload>(token, {
        secret: this.configService.get<string>('PLATFORM_JWT_SECRET'),
      });
    } catch {
      throw new UnauthorizedException('Invalid or expired access token');
    }

    const user = await this.prisma.platformUser.findUnique({ where: { id: payload.sub } });
    if (!user) {
      throw new UnauthorizedException('Account no longer exists');
    }
    if (user.status !== 'ACTIVE') {
      throw new UnauthorizedException('This account is not active');
    }

    request.platformUser = { id: user.id, email: user.email };
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
