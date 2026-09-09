import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';

@Injectable()
export class AdminUsersService {
  constructor(private readonly prisma: PrismaService) {}

  // Minimal read used to populate "assign to admin" dropdowns (Prompt 6
  // tickets). Full admin-user management isn't in scope for any prompt so far.
  list() {
    return this.prisma.adminUser.findMany({
      where: { status: 'ACTIVE' },
      select: { id: true, name: true, role: true },
      orderBy: { name: 'asc' },
    });
  }
}
