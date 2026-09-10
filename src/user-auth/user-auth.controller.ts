import { Controller, Post } from '@nestjs/common';
import { UserAuthService } from './user-auth.service.js';

// Route shape mirrors admin-auth's (register/login/refresh/logout/me), under
// /api/auth instead of /admin/auth. All four throw NotImplementedException
// for now -- see UserAuthService. Real DTOs (RegisterDto/LoginDto/RefreshDto)
// and the `me` route land alongside the real implementation in Prompt 2.
@Controller('api/auth')
export class UserAuthController {
  constructor(private readonly userAuthService: UserAuthService) {}

  @Post('register')
  register() {
    return this.userAuthService.register();
  }

  @Post('login')
  login() {
    return this.userAuthService.login();
  }

  @Post('refresh')
  refresh() {
    return this.userAuthService.refresh();
  }

  @Post('logout')
  logout() {
    return this.userAuthService.logout();
  }
}
