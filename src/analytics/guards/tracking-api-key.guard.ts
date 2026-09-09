import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Request } from 'express';

// Placeholder auth for POST /admin/analytics/track. The future end-user app
// doesn't have its own auth system yet, so this shared-secret header is the
// only thing standing between this endpoint and the public internet. Replace
// with real end-user session/JWT verification once that app exists --
// AdminAuthGuard doesn't apply here since the caller is an end-user device,
// not an admin.
@Injectable()
export class TrackingApiKeyGuard implements CanActivate {
  constructor(private readonly configService: ConfigService) {}

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<Request>();
    const apiKey = request.headers['x-api-key'];
    const expected = this.configService.get<string>('USAGE_TRACKING_API_KEY');
    if (!expected || apiKey !== expected) {
      throw new UnauthorizedException('Invalid or missing API key');
    }
    return true;
  }
}
