import { AdminRole } from '../../common/roles.js';

export interface RequestAdminUser {
  id: string;
  email: string;
  role: AdminRole;
}
