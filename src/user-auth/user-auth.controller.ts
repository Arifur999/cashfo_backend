import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Req,
  UploadedFile,
  UseFilters,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { Throttle } from '@nestjs/throttler';
import { LOGIN_THROTTLE } from '../common/login-throttle.js';
import type { Request } from 'express';
import type { ClientInfo } from '../auth/auth-sessions.service.js';
import { ChangePasswordDto } from './dto/change-password.dto.js';
import { ForgotPasswordDto } from './dto/forgot-password.dto.js';
import { LoginDto } from './dto/login.dto.js';
import { RefreshDto } from './dto/refresh.dto.js';
import { RegisterDto } from './dto/register.dto.js';
import { ResetPasswordDto } from './dto/reset-password.dto.js';
import { UpdateLanguageDto } from './dto/update-language.dto.js';
import { UpdateProfileDto } from './dto/update-profile.dto.js';
import { CurrentUser } from './decorators/current-user.decorator.js';
import { LoginRateLimitFilter } from './filters/login-rate-limit.filter.js';
import { UserAuthGuard } from './guards/user-auth.guard.js';
import type { RequestUser } from './interfaces/request-user.interface.js';
import { userAvatarMulterOptions } from './user-avatar-upload.js';
import { UserAuthService } from './user-auth.service.js';
import { UserProfileService } from './user-profile.service.js';
import { UserSessionsService } from './user-sessions.service.js';
import { ImgbbService } from '../uploads/imgbb.service.js';

@Controller('api/auth')
export class UserAuthController {
  constructor(
    private readonly userAuthService: UserAuthService,
    private readonly userProfileService: UserProfileService,
    private readonly userSessionsService: UserSessionsService,
    private readonly imgbbService: ImgbbService,
  ) {}

  // req.ip already honours TRUST_PROXY, and the frontend forwards the
  // visitor's X-Forwarded-For and User-Agent with every call. (Custom
  // x-client-ip / x-client-user-agent headers used to win over both, so
  // anything able to reach the API could write any IP into login history,
  // devices and sessions.)
  private resolveClientInfo(req: Request): ClientInfo {
    return { ipAddress: req.ip, userAgent: req.headers['user-agent'] };
  }

  // 10 new accounts per hour per IP: room for a family or an office behind
  // one address, and a ceiling on scripted signups.
  @Throttle({ default: { limit: 10, ttl: 60 * 60 * 1000 } })
  @Post('register')
  register(@Body() dto: RegisterDto, @Req() req: Request) {
    return this.userAuthService.register(dto, this.resolveClientInfo(req));
  }

  // Same policy as admin login: 5 per IP and account, 30 per IP.
  @Throttle(LOGIN_THROTTLE)
  @UseFilters(LoginRateLimitFilter)
  @Post('login')
  login(@Body() dto: LoginDto, @Req() req: Request) {
    return this.userAuthService.login(dto, this.resolveClientInfo(req));
  }

  // The second half of Google sign-in: the better-auth session cookie the
  // callback left in the browser, forwarded by the frontend, for tokens.
  @Throttle({ default: { limit: 10, ttl: 60 * 1000 } })
  @Post('session/exchange')
  exchangeSession(@Req() req: Request) {
    return this.userAuthService.exchangeSession(req.headers.cookie, this.resolveClientInfo(req));
  }

  @Post('refresh')
  refresh(@Body() dto: RefreshDto) {
    return this.userAuthService.refresh(dto.refreshToken);
  }

  // Tighter than login's 5/15min -- this route's only real traffic pattern
  // is a genuine user retrying once or twice, so a lower ceiling stops
  // email-bombing/enumeration probing without hurting anyone legitimate.
  @Throttle({ default: { limit: 3, ttl: 15 * 60 * 1000 } })
  @Post('forgot-password')
  forgotPassword(@Body() dto: ForgotPasswordDto) {
    return this.userAuthService.forgotPassword(dto.email);
  }

  @Throttle({ default: { limit: 5, ttl: 15 * 60 * 1000 } })
  @Post('reset-password')
  resetPassword(@Body() dto: ResetPasswordDto, @Req() req: Request) {
    return this.userAuthService.resetPassword(dto.token, dto.newPassword, this.resolveClientInfo(req));
  }

  @Post('logout')
  logout(@Body() dto: RefreshDto) {
    return this.userAuthService.logout(dto.refreshToken);
  }

  @UseGuards(UserAuthGuard)
  @Get('me')
  me(@CurrentUser() user: RequestUser) {
    return this.userProfileService.me(user.id);
  }

  @UseGuards(UserAuthGuard)
  @Patch('language')
  updateLanguage(@CurrentUser() user: RequestUser, @Body() dto: UpdateLanguageDto) {
    return this.userProfileService.updateLanguage(user.id, dto);
  }

  @UseGuards(UserAuthGuard)
  @Patch('profile')
  updateProfile(@CurrentUser() user: RequestUser, @Body() dto: UpdateProfileDto) {
    return this.userProfileService.updateProfile(user.id, dto);
  }

  @UseGuards(UserAuthGuard)
  @Post('avatar')
  @UseInterceptors(FileInterceptor('file', userAvatarMulterOptions))
  async uploadAvatar(@CurrentUser() user: RequestUser, @UploadedFile() file: Express.Multer.File) {
    if (!file) {
      throw new BadRequestException('No file was uploaded');
    }
    const avatarUrl = await this.imgbbService.uploadImage(file.buffer, file.originalname);
    return this.userProfileService.updateAvatar(user.id, avatarUrl);
  }

  // Checks the current password, so it gets the login's brute-force budget
  // rather than the global 100 a minute.
  @Throttle({ default: { limit: 5, ttl: 15 * 60 * 1000 } })
  @UseGuards(UserAuthGuard)
  @Post('change-password')
  changePassword(@CurrentUser() user: RequestUser, @Body() dto: ChangePasswordDto) {
    return this.userAuthService.changePassword(user.id, user.sessionId, dto);
  }

  @UseGuards(UserAuthGuard)
  @Get('sessions')
  listSessions(@CurrentUser() user: RequestUser) {
    return this.userSessionsService.list(user.id, user.sessionId);
  }

  @UseGuards(UserAuthGuard)
  @Delete('sessions/:id')
  revokeSession(@CurrentUser() user: RequestUser, @Param('id') id: string) {
    return this.userSessionsService.revoke(user.id, id);
  }

  @UseGuards(UserAuthGuard)
  @Get('login-history')
  getLoginHistory(@CurrentUser() user: RequestUser) {
    return this.userSessionsService.loginHistory(user.email);
  }
}
