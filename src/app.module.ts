import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { AccountTemplatesModule } from './account-templates/account-templates.module.js';
import { AdminAuthModule } from './admin-auth/admin-auth.module.js';
import { AdminUsersModule } from './admin-users/admin-users.module.js';
import { AnalyticsModule } from './analytics/analytics.module.js';
import { AnnouncementsModule } from './announcements/announcements.module.js';
import { AppController } from './app.controller.js';
import { AppService } from './app.service.js';
import { CategoriesModule } from './categories/categories.module.js';
import { CouponsModule } from './coupons/coupons.module.js';
import { FeatureRequestsModule } from './feature-requests/feature-requests.module.js';
import { HealthModule } from './health/health.module.js';
import { InvoicesModule } from './invoices/invoices.module.js';
import { LegalDocumentsModule } from './legal-documents/legal-documents.module.js';
import { PaymentsModule } from './payments/payments.module.js';
import { PlatformUsersModule } from './platform-users/platform-users.module.js';
import { PrismaModule } from './prisma/prisma.module.js';
import { RevenueModule } from './revenue/revenue.module.js';
import { SubscriptionPlansModule } from './subscription-plans/subscription-plans.module.js';
import { TicketsModule } from './tickets/tickets.module.js';
import { TranslationsModule } from './translations/translations.module.js';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    // Generous global default -- the login route overrides this with a
    // stricter limit via @Throttle() rather than every route sharing one
    // tight budget.
    ThrottlerModule.forRoot([{ name: 'default', ttl: 60_000, limit: 100 }]),
    PrismaModule,
    HealthModule,
    AdminAuthModule,
    AdminUsersModule,
    PlatformUsersModule,
    SubscriptionPlansModule,
    CouponsModule,
    PaymentsModule,
    InvoicesModule,
    RevenueModule,
    AccountTemplatesModule,
    CategoriesModule,
    TranslationsModule,
    LegalDocumentsModule,
    AnnouncementsModule,
    TicketsModule,
    FeatureRequestsModule,
    AnalyticsModule,
  ],
  controllers: [AppController],
  providers: [AppService, { provide: APP_GUARD, useClass: ThrottlerGuard }],
})
export class AppModule {}
