import { Injectable } from '@nestjs/common';
import type { PaymentGateway } from '@prisma/client';
import { ManualGatewayProvider } from './manual.gateway.js';
import type { PaymentGatewayProvider } from './payment-gateway.js';

// Which provider handles a payment. Payment.gateway is the way the
// customer chose to pay (BKASH, NAGAD, CARD); until a real provider for it
// is registered and configured, the manual one handles it.
@Injectable()
export class PaymentGateways {
  private readonly providers = new Map<PaymentGateway, PaymentGatewayProvider>();

  constructor(readonly manual: ManualGatewayProvider) {}

  register(provider: PaymentGatewayProvider) {
    this.providers.set(provider.id, provider);
  }

  providerFor(gateway: PaymentGateway): PaymentGatewayProvider {
    const provider = this.providers.get(gateway);
    return provider?.isConfigured() ? provider : this.manual;
  }

  // The provider whose webhook this is: only a configured, real one.
  webhookProvider(gateway: string): PaymentGatewayProvider | null {
    const provider = this.providers.get(gateway.toUpperCase() as PaymentGateway);
    return provider && provider.isConfigured() && provider.verifyWebhook ? provider : null;
  }

  // Whether anything but the manual way is set up (for health and the
  // admin dashboard later).
  anyConfigured(): boolean {
    return [...this.providers.values()].some((provider) => provider.isConfigured());
  }
}
