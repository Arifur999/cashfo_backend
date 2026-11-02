import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_FILTER, APP_GUARD } from '@nestjs/core';
import { ThrottlerModule } from '@nestjs/throttler';
import { AccountDeletionModule } from './account-deletion/account-deletion.module.js';
import { AccountExportModule } from './account-export/account-export.module.js';
import { AccountTemplatesModule } from './account-templates/account-templates.module.js';
import { AccountsModule } from './accounts/accounts.module.js';
import { AdminAuthModule } from './admin-auth/admin-auth.module.js';
import { AdminFeedModule } from './admin-feed/admin-feed.module.js';
import { AdminInvitesModule } from './admin-invites/admin-invites.module.js';
import { AdminOwnersModule } from './admin-owners/admin-owners.module.js';
import { AdminUsersModule } from './admin-users/admin-users.module.js';
import { AdminWorkspacesModule } from './admin-workspaces/admin-workspaces.module.js';
import { AnalyticsModule } from './analytics/analytics.module.js';
import { AnnouncementsModule } from './announcements/announcements.module.js';
import { AppController } from './app.controller.js';
import { AppService } from './app.service.js';
import { AssetsModule } from './assets/assets.module.js';
import { AuthModule } from './auth/auth.module.js';
import { AuditLogsModule } from './audit-logs/audit-logs.module.js';
import { BillingModule } from './billing/billing.module.js';
import { BudgetsModule } from './budgets/budgets.module.js';
import { BusinessAccessModule } from './business-access/business-access.module.js';
import { BusinessesModule } from './businesses/businesses.module.js';
import { CategoriesModule } from './categories/categories.module.js';
import { ContactsModule } from './contacts/contacts.module.js';
import { CouponsModule } from './coupons/coupons.module.js';
import { DashboardModule } from './dashboard/dashboard.module.js';
import { FeatureRequestsModule } from './feature-requests/feature-requests.module.js';
import { GroupExpensesModule } from './group-expenses/group-expenses.module.js';
import { BooksModule } from './books/books.module.js';
import { HabitsModule } from './habits/habits.module.js';
import { HealthModule } from './health/health.module.js';
import { HousekeepingModule } from './housekeeping/housekeeping.module.js';
import { InvoicesModule } from './invoices/invoices.module.js';
import { LegalDocumentsModule } from './legal-documents/legal-documents.module.js';
import { NotificationsModule } from './notifications/notifications.module.js';
import { PasswordVaultModule } from './password-vault/password-vault.module.js';
import { PaymentsModule } from './payments/payments.module.js';
import { PlatformUsersModule } from './platform-users/platform-users.module.js';
import { PrismaModule } from './prisma/prisma.module.js';
import { PlatformModule } from './platform/platform.module.js';
import { QuickEntriesModule } from './quick-entries/quick-entries.module.js';
import { ReceivablesPayablesModule } from './receivables-payables/receivables-payables.module.js';
import { PushModule } from './push/push.module.js';
import { ProfileCardModule } from './profile-card/profile-card.module.js';
import { ReferralsModule } from './referrals/referrals.module.js';
import { RemindersModule } from './reminders/reminders.module.js';
import { ReportsModule } from './reports/reports.module.js';
import { RevenueModule } from './revenue/revenue.module.js';
import { SavingsGoalsModule } from './savings-goals/savings-goals.module.js';
import { SecurityModule } from './security/security.module.js';
import { SkillsModule } from './skills/skills.module.js';
import { SettingsModule } from './settings/settings.module.js';
import { SignInModule } from './sign-in/sign-in.module.js';
import { SubscriptionPlansModule } from './subscription-plans/subscription-plans.module.js';
import { GlobalExceptionFilter } from './system/filters/global-exception.filter.js';
import { LoggingThrottlerGuard } from './system/logging-throttler.guard.js';
import { SupportModule } from './support/support.module.js';
import { SupportAccessModule } from './support-access/support-access.module.js';
import { SystemModule } from './system/system.module.js';
import { TicketsModule } from './tickets/tickets.module.js';
import { TodosModule } from './todos/todos.module.js';
import { TransactionsModule } from './transactions/transactions.module.js';
import { TranslationsModule } from './translations/translations.module.js';
import { TwoStepModule } from './two-step/two-step.module.js';
import { UserAuthModule } from './user-auth/user-auth.module.js';
import { UserNotificationsModule } from './user-notifications/user-notifications.module.js';
import { EmailVerificationModule } from './email-verification/email-verification.module.js';
import { MonthlySummaryModule } from './monthly-summary/monthly-summary.module.js';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    // Generous global default -- the login route overrides this with a
    // stricter limit via @Throttle() rather than every route sharing one
    // tight budget.
    // "perIp" mirrors "default" everywhere except the sign-in routes, which
    // count per IP and account on "default" (see common/login-throttle.ts).
    ThrottlerModule.forRoot([
      { name: 'default', ttl: 60_000, limit: 100 },
      { name: 'perIp', ttl: 60_000, limit: 100 },
    ]),
    PrismaModule,
    // The five-minute tidy-up timer other modules register jobs with.
    HousekeepingModule,
    AuthModule,
    // Two-step sign-in (TOTP, backup codes, trusted computers), both sides.
    TwoStepModule,
    BusinessAccessModule,
    HealthModule,
    AdminAuthModule,
    AdminUsersModule,
    // Admin invites by email link, and the admin forgot-password email.
    AdminInvitesModule,
    AdminWorkspacesModule,
    AdminOwnersModule,
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
    AuditLogsModule,
    SecurityModule,
    SystemModule,
    NotificationsModule,
    DashboardModule,
    SettingsModule,
    // Customer-facing platform info + the maintenance-mode switch for /api/*.
    PlatformModule,
    UserAuthModule,
    // A customer's support codes for "View as customer".
    SupportAccessModule,
    SignInModule,
    BusinessesModule,
    AccountsModule,
    TransactionsModule,
    QuickEntriesModule,
    ReportsModule,
    ContactsModule,
    ReceivablesPayablesModule,
    ReferralsModule,
    ProfileCardModule,
    BudgetsModule,
    SavingsGoalsModule,
    AssetsModule,
    PasswordVaultModule,
    GroupExpensesModule,
    HabitsModule,
    BooksModule,
    SkillsModule,
    TodosModule,
    UserNotificationsModule,
    EmailVerificationModule,
    MonthlySummaryModule,
    // Web push, and the Habit Tracker reminders that use it (the one timer).
    PushModule,
    RemindersModule,
    SupportModule,
    AccountExportModule,
    // Delete my account, with a 30-day grace and the purge after it.
    AccountDeletionModule,
    AdminFeedModule,
    // Customer plans, the in-app checkout and plan expiry (api/billing).
    BillingModule,
  ],
  controllers: [AppController],
  providers: [AppService, { provide: APP_GUARD, useClass: LoggingThrottlerGuard }, { provide: APP_FILTER, useClass: GlobalExceptionFilter }],
})
export class AppModule {}
