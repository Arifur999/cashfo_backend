import { Controller, Get, ServiceUnavailableException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';

// Separate from HealthController (`/health`, used by the admin panel) --
// the end-user app gets its own health surface under /api/* so the two
// frontends never need to know about each other's route prefix.
@Controller('api/health')
export class ApiHealthController {
  constructor(private readonly prisma: PrismaService) {}

  @Get()
  async check() {
    try {
      await this.prisma.$queryRaw`SELECT 1`;
      return { status: 'ok', timestamp: new Date().toISOString() };
    } catch {
      throw new ServiceUnavailableException({
        status: 'error',
        timestamp: new Date().toISOString(),
        message: 'Database connection failed',
      });
    }
  }
}
