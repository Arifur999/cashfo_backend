import { MemberRole } from '@prisma/client';

export interface RequestBusinessMember {
  businessId: string;
  userId: string;
  role: MemberRole;
}
