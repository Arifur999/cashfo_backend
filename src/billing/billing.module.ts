import { Module } from '@nestjs/common';
import { InvoicePdfModule } from '../invoices/invoice-pdf.module.js';
import { MailModule } from '../mail/mail.module.js';
import { SettingsModule } from '../settings/settings.module.js';
import { UserAuthModule } from '../user-auth/user-auth.module.js';
import { BillingController, BillingWebhooksController } from './billing.controller.js';
import { BillingHooks } from './billing-hooks.js';
import { BillingHousekeeping } from './billing-housekeeping.js';
import { BillingNotices } from './billing-notices.js';
import { BillingService } from './billing.service.js';
import { ManualGatewayProvider } from './gateways/manual.gateway.js';
import { PaymentGateways } from './gateways/payment-gateways.js';
import { PaymentConfirmationService } from './payment-confirmation.service.js';
import { SubscriptionsService } from './subscriptions.service.js';

// Customer plans and payments: the subscription (the source of truth for a
// customer's plan), the in-app checkout, confirming a payment (an admin's
// Mark paid, or a gateway's webhook) and the plan's expiry. The admin
// payments and owners modules import it for Mark paid and Change plan.
@Module({
  // InvoicePdfModule: the invoice PDF for the receipt and the customer's download.
  imports: [UserAuthModule, SettingsModule, MailModule, InvoicePdfModule],
  controllers: [BillingController, BillingWebhooksController],
  providers: [
    BillingService,
    SubscriptionsService,
    PaymentConfirmationService,
    BillingNotices,
    BillingHooks,
    BillingHousekeeping,
    ManualGatewayProvider,
    PaymentGateways,
  ],
  exports: [SubscriptionsService, PaymentConfirmationService, BillingNotices, BillingHooks, PaymentGateways],
})
export class BillingModule {}
