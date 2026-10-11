import { AdminRole } from '../../common/roles.js';

export interface RequestAdminUser {
  id: string;
  email: string;
  role: AdminRole;
  // The better-auth session this request's token is bound to.
  sessionId: string;
}
