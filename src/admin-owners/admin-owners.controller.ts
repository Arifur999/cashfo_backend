import { Body, Controller, Delete, Get, Header, HttpCode, Param, Patch, Post, Query, Req, StreamableFile, UseGuards } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import type { Request } from 'express';
import { AdminRole } from '../common/roles.js';
import { CurrentAdmin } from '../admin-auth/decorators/current-admin.decorator.js';
import { Roles } from '../admin-auth/decorators/roles.decorator.js';
import { AdminAuthGuard } from '../admin-auth/guards/admin-auth.guard.js';
import { RolesGuard } from '../admin-auth/guards/roles.guard.js';
import type { RequestAdminUser } from '../admin-auth/interfaces/request-admin-user.interface.js';
import { AdminNotesService } from './admin-notes.service.js';
import { AdminOwnersService } from './admin-owners.service.js';
import { CreateAdminNoteDto } from './dto/admin-note.dto.js';
import { ChangeOwnerPlanDto } from './dto/change-owner-plan.dto.js';
import { ListOwnersQueryDto } from './dto/list-owners-query.dto.js';
import { SupportCodeDto } from './dto/support-code.dto.js';
import { SuspendOwnerDto } from './dto/suspend-owner.dto.js';
import { OwnerImpersonationService } from './owner-impersonation.service.js';

@UseGuards(AdminAuthGuard, RolesGuard)
@Controller('admin/owners')
export class AdminOwnersController {
  constructor(
    private readonly adminOwnersService: AdminOwnersService,
    private readonly impersonation: OwnerImpersonationService,
    private readonly notes: AdminNotesService,
  ) {}

  // No @Roles() -- any authenticated admin can view the list/detail, same
  // convention as AdminWorkspacesController's GET route.
  @Get()
  list(@Query() query: ListOwnersQueryDto) {
    return this.adminOwnersService.list(query);
  }

  // Users > Export CSV: the whole filtered list, not just the page shown.
  // Declared before ':userId' so "export" is never read as a user id.
  @Roles(AdminRole.SUPER_ADMIN, AdminRole.SUPPORT_ADMIN)
  @Throttle({ default: { limit: 10, ttl: 60 * 1000 } })
  @Get('export')
  @Header('Cache-Control', 'private, no-store')
  async exportList(@Query() query: ListOwnersQueryDto, @CurrentAdmin() admin: RequestAdminUser, @Req() req: Request) {
    const file = await this.adminOwnersService.exportList(query, admin.id, req.ip);
    return new StreamableFile(file.data, { type: 'text/csv; charset=utf-8', disposition: `attachment; filename="${file.fileName}"` });
  }

  @Get(':userId')
  getById(@Param('userId') userId: string) {
    return this.adminOwnersService.getById(userId);
  }

  // "Notes for admins": any admin reads them; support and super admins
  // write; the author or a super admin removes one.
  @Get(':userId/notes')
  listNotes(@Param('userId') userId: string, @CurrentAdmin() admin: RequestAdminUser) {
    return this.notes.list(userId, admin);
  }

  @Roles(AdminRole.SUPER_ADMIN, AdminRole.SUPPORT_ADMIN)
  @Post(':userId/notes')
  addNote(@Param('userId') userId: string, @Body() dto: CreateAdminNoteDto, @CurrentAdmin() admin: RequestAdminUser, @Req() req: Request) {
    return this.notes.add(userId, dto.body, admin, req.ip);
  }

  @Roles(AdminRole.SUPER_ADMIN, AdminRole.SUPPORT_ADMIN)
  @Delete(':userId/notes/:noteId')
  removeNote(@Param('userId') userId: string, @Param('noteId') noteId: string, @CurrentAdmin() admin: RequestAdminUser, @Req() req: Request) {
    return this.notes.remove(userId, noteId, admin, req.ip);
  }

  // "Sign out of all devices" on the user's page.
  @Roles(AdminRole.SUPER_ADMIN, AdminRole.SUPPORT_ADMIN)
  @Post(':userId/sign-out-everywhere')
  @HttpCode(200)
  signOutEverywhere(@Param('userId') userId: string, @CurrentAdmin() admin: RequestAdminUser, @Req() req: Request) {
    return this.adminOwnersService.signOutEverywhere(userId, admin.id, req.ip);
  }

  // "Download a copy" before a reset: the customer's Download my data zip,
  // only with the support code they made (a POST, as the code is used up).
  @Roles(AdminRole.SUPER_ADMIN)
  @Throttle({ default: { limit: 5, ttl: 15 * 60 * 1000, getTracker: (req) => `${req.ip}|${req.params?.userId ?? ''}` } })
  @Post(':userId/export')
  @HttpCode(200)
  @Header('Cache-Control', 'private, no-store')
  async exportOwnerData(@Param('userId') userId: string, @Body() dto: SupportCodeDto, @CurrentAdmin() admin: RequestAdminUser, @Req() req: Request) {
    const file = await this.adminOwnersService.exportOwnerData(userId, dto.code, admin.id, req.ip);
    return new StreamableFile(file.data, { type: 'application/zip', disposition: `attachment; filename="${file.fileName}"` });
  }

  // Cancels a customer's "Delete my account" inside its 30 days.
  @Roles(AdminRole.SUPER_ADMIN, AdminRole.SUPPORT_ADMIN)
  @Post(':userId/restore')
  @HttpCode(200)
  restore(@Param('userId') userId: string, @CurrentAdmin() admin: RequestAdminUser, @Req() req: Request) {
    return this.adminOwnersService.restore(userId, admin.id, req.ip);
  }

  @Roles(AdminRole.SUPER_ADMIN, AdminRole.SUPPORT_ADMIN)
  @Patch(':userId/suspend')
  suspend(@Param('userId') userId: string, @Body() dto: SuspendOwnerDto, @CurrentAdmin() admin: RequestAdminUser, @Req() req: Request) {
    return this.adminOwnersService.suspend(userId, dto, admin.id, req.ip);
  }

  @Roles(AdminRole.SUPER_ADMIN, AdminRole.SUPPORT_ADMIN)
  @Patch(':userId/activate')
  activate(@Param('userId') userId: string, @CurrentAdmin() admin: RequestAdminUser, @Req() req: Request) {
    return this.adminOwnersService.activate(userId, admin.id, req.ip);
  }

  @Roles(AdminRole.SUPER_ADMIN, AdminRole.FINANCE_ADMIN)
  @Patch(':userId/change-plan')
  changePlan(@Param('userId') userId: string, @Body() dto: ChangeOwnerPlanDto, @CurrentAdmin() admin: RequestAdminUser, @Req() req: Request) {
    return this.adminOwnersService.changePlan(userId, dto, admin.id, req.ip);
  }

  // Turns off two-step sign-in for a customer who lost their phone and
  // backup codes. SUPER_ADMIN only, audited, and the customer is told.
  @Roles(AdminRole.SUPER_ADMIN)
  @Post(':userId/two-step/disable')
  disableTwoStep(@Param('userId') userId: string, @CurrentAdmin() admin: RequestAdminUser, @Req() req: Request) {
    return this.adminOwnersService.disableTwoStep(userId, admin.id, req.ip);
  }

  // SUPER_ADMIN only -- this permanently wipes a real owner's business/
  // financial data, same bar as AdminUsersController's suspend/ban/reset-password.
  @Roles(AdminRole.SUPER_ADMIN)
  @Post(':userId/reset')
  reset(@Param('userId') userId: string, @CurrentAdmin() admin: RequestAdminUser, @Req() req: Request) {
    return this.adminOwnersService.resetOwnerData(userId, admin.id, req.ip);
  }

  // "View as customer" (read-only, see OwnerImpersonationService): customer
  // tokens for a session of this owner. SUPER_ADMIN only -- it shows a real
  // customer's books -- and only with the support code the customer made.
  // The code itself burns after five wrong tries; this also caps tries per
  // address and customer.
  @Roles(AdminRole.SUPER_ADMIN)
  @Throttle({ default: { limit: 5, ttl: 15 * 60 * 1000, getTracker: (req) => `${req.ip}|${req.params?.userId ?? ''}` } })
  @Post(':userId/impersonate')
  impersonate(@Param('userId') userId: string, @Body() dto: SupportCodeDto, @CurrentAdmin() admin: RequestAdminUser, @Req() req: Request) {
    return this.impersonation.start(userId, admin.id, { ipAddress: req.ip, userAgent: req.headers['user-agent'] }, dto.code);
  }

  @Roles(AdminRole.SUPER_ADMIN)
  @Delete(':userId/impersonate')
  endImpersonation(@Param('userId') userId: string, @CurrentAdmin() admin: RequestAdminUser, @Req() req: Request) {
    return this.impersonation.end(userId, admin.id, req.ip);
  }
}
