import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { Request } from 'express';
import { PrismaService } from '../../prisma/prisma.service.js';
import { RequestAdminUser } from '../interfaces/request-admin-user.interface.js';

interface AccessTokenPayload {
  sub: string;
}

// Verifies the access token and attaches `request.adminUser`. Apply this
// before RolesGuard on any route that needs authentication -- RolesGuard
// assumes `request.adminUser` is already set.
@Injectable()
export class AdminAuthGuard implements CanActivate {
  constructor(
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
    private readonly prisma: PrismaService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<Request & { adminUser?: RequestAdminUser }>();
    const token = this.extractToken(request);
    if (!token) {
      throw new UnauthorizedException('Access token missing');
    }

    let payload: AccessTokenPayload;
    try {
      payload = this.jwtService.verify<AccessTokenPayload>(token, {
        secret: this.configService.get<string>('JWT_SECRET'),
      });
    } catch {
      throw new UnauthorizedException('Invalid or expired access token');
    }

    const admin = await this.prisma.adminUser.findUnique({ where: { id: payload.sub } });
    if (!admin) {
      throw new UnauthorizedException('Admin no longer exists');
    }
    if (admin.status !== 'ACTIVE') {
      throw new UnauthorizedException('This admin account has been suspended');
    }

    request.adminUser = { id: admin.id, email: admin.email, role: admin.role };
    return true;
  }

  // Prefer the Authorization header (the admin frontend forwards its
  // httpOnly-cookie-stored token this way), fall back to a same-origin
  // cookie if one is present.
  private extractToken(request: Request): string | undefined {
    const authHeader = request.headers.authorization;
    if (authHeader?.startsWith('Bearer ')) {
      return authHeader.slice('Bearer '.length);
    }
    return (request as Request & { cookies?: Record<string, string> }).cookies?.accessToken;
  }
}
