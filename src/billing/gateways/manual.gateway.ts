import { Injectable } from '@nestjs/common';
import type { Payment } from '@prisma/client';
import { SettingsService } from '../../settings/settings.service.js';
import { displayPaymentId, fillTemplate, formatTaka, methodName } from '../billing-text.js';
import { toPaisa } from '../pricing.js';
import type { CheckoutNext, PaymentGatewayProvider } from './payment-gateway.js';

// The customer sends the money by bKash, Nagad or card themselves, with
// the payment's reference; an admin checks it arrived and presses Mark
// paid. The words are the admin's (Settings > billing instructions).
@Injectable()
export class ManualGatewayProvider implements PaymentGatewayProvider {
  readonly id = 'MANUAL' as const;

  constructor(private readonly settingsService: SettingsService) {}

  isConfigured(): boolean {
    return true;
  }

  async startCheckout(payment: Payment): Promise<CheckoutNext> {
    return { kind: 'instructions', text: await this.instructionsFor(payment) };
  }

  async instructionsFor(payment: Pick<Payment, 'id' | 'amount' | 'gateway'>): Promise<{ en: string; bn: string }> {
    const settings = await this.settingsService.getCached();
    const reference = displayPaymentId(payment.id);
    const paisa = toPaisa(payment.amount);
    return {
      en: fillTemplate(settings.billingManualInstructionsEn, { amount: formatTaka(paisa, 'en'), reference, method: methodName(payment.gateway, 'en') }),
      bn: fillTemplate(settings.billingManualInstructionsBn, { amount: formatTaka(paisa, 'bn'), reference, method: methodName(payment.gateway, 'bn') }),
    };
  }
}
