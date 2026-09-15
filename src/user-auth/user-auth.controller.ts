import { BadRequestException, Body, Controller, Delete, Get, Param, Patch, Post, Req, UploadedFile, UseFilters, UseGuards, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { Throttle } from '@nestjs/throttler';
import type { Request } from 'express';
import { ChangePasswordDto } from './dto/change-password.dto.js';
import { LoginDto } from './dto/login.dto.js';
import { RefreshDto } from './dto/refresh.dto.js';
import { RegisterDto } from './dto/register.dto.js';
import { UpdateLanguageDto } from './dto/update-language.dto.js';
import { UpdateProfileDto } from './dto/update-profile.dto.js';
import { CurrentUser } from './decorators/current-user.decorator.js';
import { LoginRateLimitFilter } from './filters/login-rate-limit.filter.js';
import { UserAuthGuard } from './guards/user-auth.guard.js';
import type { RequestUser } from './interfaces/request-user.interface.js';
import { userAvatarMulterOptions } from './user-avatar-upload.js';
import { UserAuthService } from './user-auth.service.js';

@Controller('api/auth')
export class UserAuthController {
  constructor(private readonly userAuthService: UserAuthService) {}

  // Both frontends only ever call this backend server-side (Server
  // Actions/Route Handlers, never the browser directly -- see CLAUDE.md),
  // so req.ip/req.headers['user-agent'] normally reflect axios's own
  // request from the Node process, not the real end user's device. The two
  // login/register Server Actions that create a UserSession (see
  // clientContext.ts's comment) forward the REAL browser's info in these
  // two custom headers; every other caller (curl, a script, anything that
  // doesn't set them) still falls back to the raw request exactly as
  // before this existed.
  private resolveClientInfo(req: Request): { ip: string | undefined; userAgent: string | undefined } {
    const forwardedUserAgent = req.headers['x-client-user-agent'];
    const forwardedIp = req.headers['x-client-ip'];
    return {
      ip: (Array.isArray(forwardedIp) ? forwardedIp[0] : forwardedIp) ?? req.ip,
      userAgent: (Array.isArray(forwardedUserAgent) ? forwardedUserAgent[0] : forwardedUserAgent) ?? req.headers['user-agent'],
    };
  }

  @Post('register')
  register(@Body() dto: RegisterDto, @Req() req: Request) {
    const { ip, userAgent } = this.resolveClientInfo(req);
    return this.userAuthService.register(dto, ip, userAgent);
  }

  // Max 5 attempts per 15 minutes per IP, same policy as admin login.
  @Throttle({ default: { limit: 5, ttl: 15 * 60 * 1000 } })
  @UseFilters(LoginRateLimitFilter)
  @Post('login')
  login(@Body() dto: LoginDto, @Req() req: Request) {
    const { ip, userAgent } = this.resolveClientInfo(req);
    return this.userAuthService.login(dto, ip, userAgent);
  }

  @Post('refresh')
  refresh(@Body() dto: RefreshDto) {
    return this.userAuthService.refresh(dto.refreshToken);
  }

  @Post('logout')
  logout(@Body() dto: RefreshDto) {
    return this.userAuthService.logout(dto.refreshToken);
  }

  @UseGuards(UserAuthGuard)
  @Get('me')
  me(@CurrentUser() user: RequestUser) {
    return this.userAuthService.me(user.id);
  }

  @UseGuards(UserAuthGuard)
  @Patch('language')
  updateLanguage(@CurrentUser() user: RequestUser, @Body() dto: UpdateLanguageDto) {
    return this.userAuthService.updateLanguage(user.id, dto);
  }

  @UseGuards(UserAuthGuard)
  @Patch('profile')
  updateProfile(@CurrentUser() user: RequestUser, @Body() dto: UpdateProfileDto) {
    return this.userAuthService.updateProfile(user.id, dto);
  }

  @UseGuards(UserAuthGuard)
  @Post('avatar')
  @UseInterceptors(FileInterceptor('file', userAvatarMulterOptions))
  uploadAvatar(@CurrentUser() user: RequestUser, @UploadedFile() file: Express.Multer.File, @Req() req: Request) {
    if (!file) {
      throw new BadRequestException('No file was uploaded');
    }
    const avatarUrl = `${req.protocol}://${req.get('host')}/uploads/avatars/${file.filename}`;
    return this.userAuthService.updateAvatar(user.id, avatarUrl);
  }

  @UseGuards(UserAuthGuard)
  @Post('change-password')
  changePassword(@CurrentUser() user: RequestUser, @Body() dto: ChangePasswordDto) {
    return this.userAuthService.changePassword(user.id, dto);
  }

  @UseGuards(UserAuthGuard)
  @Get('sessions')
  listSessions(@CurrentUser() user: RequestUser, @Req() req: Request) {
    const { ip, userAgent } = this.resolveClientInfo(req);
    return this.userAuthService.listSessions(user.id, ip, userAgent);
  }

  @UseGuards(UserAuthGuard)
  @Delete('sessions/:id')
  revokeSession(@CurrentUser() user: RequestUser, @Param('id') id: string) {
    return this.userAuthService.revokeSession(user.id, id);
  }

  @UseGuards(UserAuthGuard)
  @Get('login-history')
  getLoginHistory(@CurrentUser() user: RequestUser) {
    return this.userAuthService.getLoginHistory(user.email);
  }
}
