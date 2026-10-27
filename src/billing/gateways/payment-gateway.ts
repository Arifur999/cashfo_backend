import type { Payment, PaymentGateway } from '@prisma/client';
import type { Request } from 'express';

// What the app shows after a checkout: text telling the customer how to
// pay (the manual way), or a gateway page to send them to.
export type CheckoutNext = { kind: 'instructions'; text: { en: string; bn: string } } | { kind: 'redirect'; url: string };

export interface WebhookResult {
  paymentId: string;
  status: 'SUCCESS' | 'FAILED';
  reference: string;
}

// The seam for real payment gateways (bKash, Nagad, SSLCommerz). Only the
// manual provider ships: the customer sends the money themselves and an
// admin marks the payment paid. A real provider registers in
// PaymentGateways and then also confirms payments through its webhook
// (POST /api/billing/webhooks/:gateway) and can refund through the gateway.
export interface PaymentGatewayProvider {
  id: PaymentGateway;
  isConfigured(): boolean;
  startCheckout(payment: Payment): Promise<CheckoutNext>;
  verifyWebhook?(req: Request): Promise<WebhookResult | null>;
  refund?(payment: Payment, amount: number): Promise<{ reference: string }>;
}
