import { Injectable, NotImplementedException } from '@nestjs/common';

// Structure only for Prompt 1 -- full register/login/refresh/logout logic
// (bcrypt hashing, JWT signing with USER_JWT_SECRET/USER_JWT_REFRESH_SECRET,
// LoginAttempt recording, etc.) lands in Prompt 2. Mirrors AdminAuthService's
// eventual shape so that prompt has a clean structure to fill in.
@Injectable()
export class UserAuthService {
  async register(): Promise<never> {
    throw new NotImplementedException('User registration lands in Prompt 2');
  }

  async login(): Promise<never> {
    throw new NotImplementedException('User login lands in Prompt 2');
  }

  async refresh(): Promise<never> {
    throw new NotImplementedException('Token refresh lands in Prompt 2');
  }

  async logout(): Promise<never> {
    throw new NotImplementedException('Logout lands in Prompt 2');
  }
}
