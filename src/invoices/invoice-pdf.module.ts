import { Module } from '@nestjs/common';
import { MailModule } from '../mail/mail.module.js';
import { SettingsModule } from '../settings/settings.module.js';
import { InvoicePdfService } from './invoice-pdf.service.js';

// The invoice PDF on its own, so the admin invoices, the customer's billing
// page and the Mark paid receipt can all make one without importing each
// other's modules.
@Module({
  imports: [MailModule, SettingsModule],
  providers: [InvoicePdfService],
  exports: [InvoicePdfService],
})
export class InvoicePdfModule {}
