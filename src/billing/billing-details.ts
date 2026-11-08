// Settings › Plans & billing › Billing details: the name, phone and email a
// receipt carries, and the address receipts and plan reminders go to. Each
// one left unset falls back to the account's own.

export const BILLING_SELECT = { name: true, email: true, phone: true, billingName: true, billingPhone: true, billingEmail: true } as const;

export interface BillingSource {
  name: string;
  email: string;
  phone: string | null;
  billingName: string | null;
  billingPhone: string | null;
  billingEmail: string | null;
}

export interface BillingRecipient {
  name: string;
  email: string;
  phone: string | null;
}

export const billingRecipient = (user: BillingSource): BillingRecipient => ({
  name: user.billingName ?? user.name,
  email: user.billingEmail ?? user.email,
  phone: user.billingPhone ?? user.phone,
});

// The "Name <email>" snapshot an invoice keeps.
export const issuedToLine = (recipient: BillingRecipient) => `${recipient.name} <${recipient.email}>`;

// Letters in any script, with the spaces, dots, apostrophes and hyphens
// names have; no digits or symbols.
export const BILLING_NAME_REGEX = /^\p{L}[\p{L}\p{M} .'-]*$/u;

// What is stored: a value equal to the account's own is kept as null, so a
// later change to the account (a new name, say) reaches receipts too.
export function billingColumns(
  account: { name: string; email: string; phone: string | null },
  input: { name: string; phone: string | null; email: string | null },
): { billingName: string | null; billingPhone: string | null; billingEmail: string | null } {
  return {
    billingName: input.name === account.name ? null : input.name,
    billingPhone: input.phone === null || input.phone === account.phone ? null : input.phone,
    billingEmail: input.email === null || input.email === account.email ? null : input.email,
  };
}
