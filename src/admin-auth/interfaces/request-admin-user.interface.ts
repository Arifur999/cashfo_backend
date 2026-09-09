import { AdminRole } from '@prisma/client';

export interface RequestAdminUser {
  id: string;
  email: string;
  role: AdminRole;
}
