import { Controller, Get, NotFoundException, Param, UseGuards } from '@nestjs/common';
import { LegalDocType } from '@prisma/client';
import { CurrentUser } from '../user-auth/decorators/current-user.decorator.js';
import { UserAuthGuard } from '../user-auth/guards/user-auth.guard.js';
import type { RequestUser } from '../user-auth/interfaces/request-user.interface.js';
import { PlatformService } from './platform.service.js';

// The URL names of the legal pages the site serves publicly.
const LEGAL_PAGES: Record<string, LegalDocType> = {
  terms: LegalDocType.TERMS_OF_SERVICE,
  privacy: LegalDocType.PRIVACY_POLICY,
  'refund-policy': LegalDocType.REFUND_POLICY,
  faq: LegalDocType.FAQ,
};

// Every route stays open during maintenance (see MaintenanceMiddleware): they
// are how the customer app learns it is on.
@Controller('api/platform')
export class PlatformController {
  constructor(private readonly platformService: PlatformService) {}

  @Get('public')
  publicInfo() {
    return this.platformService.publicInfo();
  }

  // Public, like the strings it carries: the sign-in pages show them too.
  @Get('translations')
  translations() {
    return this.platformService.translations();
  }

  // Public: read by the sign-up page and the footer links before anyone
  // signs in.
  @Get('legal/:page')
  legalDocument(@Param('page') page: string) {
    const type = Object.hasOwn(LEGAL_PAGES, page) ? LEGAL_PAGES[page] : undefined;
    if (!type) {
      throw new NotFoundException('No such page');
    }
    return this.platformService.legalDocument(type);
  }

  @UseGuards(UserAuthGuard)
  @Get()
  forCustomer(@CurrentUser() user: RequestUser) {
    return this.platformService.forCustomer(user.id);
  }
}
