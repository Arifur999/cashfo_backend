import { BadRequestException, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { EMPTY_PAYMENT_ACCOUNTS, parsePaymentAccounts, type PaymentAccounts } from '../billing/manual-payments.js';
import { PrismaService } from '../prisma/prisma.service.js';
import type { UpdateReferralSettingsDto } from './dto/update-referral-settings.dto.js';
import { UpdateSettingsDto } from './dto/update-settings.dto.js';
import { parseReferralSettings, REFERRAL_SETTING_KEYS, type ReferralSettings } from './referral-settings.js';

// Fixed, curated set of general platform settings backed by the generic
// PlatformSetting key-value table from Prompt 1 (never used until now). Kept
// as named, typed fields on the API rather than exposing raw key/value pairs
// to the admin -- same "don't make the admin hand-edit JSON" reasoning as the
// notification-campaign target filter.
// The product's name. Emails also sign off with it when the stored
// platform_name is empty or still the old 'Money Management Tracker'.
export const DEFAULT_PLATFORM_NAME = 'Smartly';

const DEFAULTS = {
  platform_name: DEFAULT_PLATFORM_NAME,
  support_email: 'support@example.com',
  default_currency: 'BDT',
  default_timezone: 'Asia/Dhaka',
  maintenance_mode: false,
  maintenance_message: "We're currently performing scheduled maintenance. Please check back soon.",
  // The same notice in Bangla, for customers using the app in Bangla.
  maintenance_message_bn: 'আমরা এখন নির্ধারিত রক্ষণাবেক্ষণের কাজ করছি। একটু পরে আবার চেষ্টা করুন।',
  // Security > "Allow new sign-ups". Off refuses every new customer
  // account (email sign-up and a first Google sign-in); admins the panel
  // creates are not affected.
  signups_open: true,
  // The old Referral Program rule's flat reward per sign-up. Only old
  // referrals carry it now; the commission rules are the referral_* keys in
  // referral-settings.ts (Admin > Referrals & Payouts > Settings).
  referral_reward_amount: 100,
  // Billing (src/billing). The manual checkout's instructions, with
  // {amount}, {reference} and {method} filled in per payment; the number
  // is the admin's to set.
  billing_manual_instructions_en:
    'Send TK {amount} by {method} to 01XXXXXXXXX (Send Money) and write {reference} as the reference. We confirm your payment within 1 working day.',
  billing_manual_instructions_bn:
    '{method}-এ 01XXXXXXXXX নম্বরে ৳ {amount} সেন্ড মানি করুন এবং রেফারেন্সে {reference} লিখুন। আমরা ১ কর্মদিবসের মধ্যে আপনার পেমেন্ট নিশ্চিত করব।',
  // Days a plan stays after its period ends without a renewal.
  billing_grace_days: 3,
  // Hours an unpaid checkout stays open.
  billing_checkout_hours: 48,
  // Where the customer sends the money (Checkout): the bKash, Nagad and
  // Rocket numbers and the bank account. Empty ones aren't offered.
  billing_payment_accounts: EMPTY_PAYMENT_ACCOUNTS,
  // Security > Admin team > "Require it for everyone": every admin must
  // use two-step sign-in; one without it sets it up before getting in.
  admin_two_step_required: false,
} as const;

// The keys Admin › Settings' General card and New sign-ups switch save.
const GENERAL_KEYS = ['platform_name', 'support_email', 'default_currency', 'default_timezone', 'signups_open'];

const KEY_TO_FIELD: Record<string, keyof PlatformSettings> = {
  platform_name: 'platformName',
  support_email: 'supportEmail',
  default_currency: 'defaultCurrency',
  default_timezone: 'defaultTimezone',
  maintenance_mode: 'maintenanceMode',
  maintenance_message: 'maintenanceMessage',
  maintenance_message_bn: 'maintenanceMessageBn',
  signups_open: 'signupsOpen',
  referral_reward_amount: 'referralRewardAmount',
  billing_manual_instructions_en: 'billingManualInstructionsEn',
  billing_manual_instructions_bn: 'billingManualInstructionsBn',
  billing_grace_days: 'billingGraceDays',
  billing_checkout_hours: 'billingCheckoutHours',
  billing_payment_accounts: 'billingPaymentAccounts',
  admin_two_step_required: 'adminTwoStepRequired',
};

export interface PlatformSettings {
  platformName: string;
  supportEmail: string;
  defaultCurrency: string;
  defaultTimezone: string;
  maintenanceMode: boolean;
  maintenanceMessage: string;
  maintenanceMessageBn: string;
  signupsOpen: boolean;
  referralRewardAmount: number;
  billingManualInstructionsEn: string;
  billingManualInstructionsBn: string;
  billingGraceDays: number;
  billingCheckoutHours: number;
  billingPaymentAccounts: PaymentAccounts;
  adminTwoStepRequired: boolean;
}

// The invited friend's first-payment discount, for checkout prices.
export interface ReferralPriceSettings {
  programLive: boolean;
  friendDiscountPct: number;
}

type Client = PrismaService | Prisma.TransactionClient;

// How long getCached() may serve a copy. The maintenance switch reads
// settings on every customer request; a few seconds of delay after an admin
// flips it is fine, a database round trip per request is not.
const CACHE_TTL_MS = 5_000;

@Injectable()
export class SettingsService {
  private cached: { value: PlatformSettings; at: number } | null = null;

  constructor(private readonly prisma: PrismaService) {}

  // For per-request readers. update() clears it, so this process sees its
  // own changes at once; so does forget(), for a setting saved elsewhere
  // (the Help card's support email).
  async getCached(): Promise<PlatformSettings> {
    if (this.cached && Date.now() - this.cached.at < CACHE_TTL_MS) {
      return this.cached.value;
    }
    const value = await this.get();
    this.cached = { value, at: Date.now() };
    return value;
  }

  forget() {
    this.cached = null;
  }

  async get(): Promise<PlatformSettings> {
    const rows = await this.prisma.platformSetting.findMany();
    const byKey = new Map(rows.map((r) => [r.key, r.value]));

    return {
      platformName: (byKey.get('platform_name') as string | undefined) ?? DEFAULTS.platform_name,
      supportEmail: (byKey.get('support_email') as string | undefined) ?? DEFAULTS.support_email,
      defaultCurrency: (byKey.get('default_currency') as string | undefined) ?? DEFAULTS.default_currency,
      defaultTimezone: (byKey.get('default_timezone') as string | undefined) ?? DEFAULTS.default_timezone,
      maintenanceMode: (byKey.get('maintenance_mode') as boolean | undefined) ?? DEFAULTS.maintenance_mode,
      maintenanceMessage: (byKey.get('maintenance_message') as string | undefined) ?? DEFAULTS.maintenance_message,
      maintenanceMessageBn: (byKey.get('maintenance_message_bn') as string | undefined) || DEFAULTS.maintenance_message_bn,
      signupsOpen: (byKey.get('signups_open') as boolean | undefined) ?? DEFAULTS.signups_open,
      referralRewardAmount: (byKey.get('referral_reward_amount') as number | undefined) ?? DEFAULTS.referral_reward_amount,
      billingManualInstructionsEn: (byKey.get('billing_manual_instructions_en') as string | undefined) || DEFAULTS.billing_manual_instructions_en,
      billingManualInstructionsBn: (byKey.get('billing_manual_instructions_bn') as string | undefined) || DEFAULTS.billing_manual_instructions_bn,
      billingGraceDays: (byKey.get('billing_grace_days') as number | undefined) ?? DEFAULTS.billing_grace_days,
      billingCheckoutHours: (byKey.get('billing_checkout_hours') as number | undefined) ?? DEFAULTS.billing_checkout_hours,
      billingPaymentAccounts: parsePaymentAccounts(byKey.get('billing_payment_accounts')),
      adminTwoStepRequired: (byKey.get('admin_two_step_required') as boolean | undefined) ?? DEFAULTS.admin_two_step_required,
    };
  }

  async getReferralPrice(): Promise<ReferralPriceSettings> {
    const { programLive, friendDiscountPct } = await this.getReferralSettings();
    return { programLive, friendDiscountPct };
  }

  // The Referral Program's rules. Takes a transaction's client so a payment
  // being confirmed reads them inside its own transaction.
  async getReferralSettings(client: Client = this.prisma): Promise<ReferralSettings> {
    const rows = await client.platformSetting.findMany({ where: { key: { in: Object.values(REFERRAL_SETTING_KEYS) } } });
    return parseReferralSettings(new Map(rows.map((r) => [r.key, r.value])));
  }

  // The admin page's copy, with who changed one of them last and when.
  async getReferralSettingsForAdmin() {
    const [settings, latest] = await Promise.all([
      this.getReferralSettings(),
      this.prisma.platformSetting.findFirst({
        where: { key: { in: Object.values(REFERRAL_SETTING_KEYS) }, updatedBy: { not: null } },
        orderBy: { updatedAt: 'desc' },
        select: { updatedAt: true, updatedBy: true },
      }),
    ]);
    const admin = latest?.updatedBy ? await this.prisma.user.findUnique({ where: { id: latest.updatedBy }, select: { name: true } }) : null;
    return { ...settings, lastChange: latest ? { at: latest.updatedAt, by: admin?.name ?? null } : null };
  }

  // Saves the fields sent, with one audit entry, in one transaction. A new
  // rate applies to payments confirmed after this: each commission keeps
  // the rate it was made with.
  async updateReferralSettings(dto: UpdateReferralSettingsDto, adminId: string, ipAddress?: string) {
    const fields = Object.keys(REFERRAL_SETTING_KEYS) as (keyof ReferralSettings)[];
    const before = await this.getReferralSettings();
    const after = { ...before } as Record<keyof ReferralSettings, unknown>;
    for (const field of fields) if (dto[field] !== undefined) after[field] = dto[field];
    if ((after.withdrawalFee as number) >= (after.minWithdrawal as number)) {
      throw new BadRequestException('The withdrawal fee must be less than the minimum withdrawal');
    }
    const changed = fields.filter((field) => JSON.stringify(after[field]) !== JSON.stringify(before[field]));
    if (changed.length > 0) {
      await this.prisma.$transaction(async (tx) => {
        for (const field of changed) {
          const key = REFERRAL_SETTING_KEYS[field];
          // maxPerMonth's "no limit" is stored as JSON null.
          const value = after[field] === null ? Prisma.JsonNull : (after[field] as Prisma.InputJsonValue);
          await tx.platformSetting.upsert({ where: { key }, update: { value, updatedBy: adminId }, create: { key, value, updatedBy: adminId } });
        }
        await tx.auditLog.create({
          data: {
            adminUserId: adminId,
            action: 'REFERRAL_SETTINGS_UPDATED',
            entityType: 'PlatformSetting',
            oldValue: Object.fromEntries(changed.map((field) => [field, before[field]])) as Prisma.InputJsonValue,
            newValue: Object.fromEntries(changed.map((field) => [field, after[field]])) as Prisma.InputJsonValue,
            ipAddress,
          },
        });
      });
    }
    return this.getReferralSettingsForAdmin();
  }

  // The admin page's copy: the settings, plus who changed one of General's
  // last and when ("Last changed by Nadia Rahman on 14 September 2026").
  async getForAdmin() {
    const [settings, latest] = await Promise.all([
      this.get(),
      this.prisma.platformSetting.findFirst({
        where: { key: { in: GENERAL_KEYS }, updatedBy: { not: null } },
        orderBy: { updatedAt: 'desc' },
        select: { updatedAt: true, updatedBy: true },
      }),
    ]);
    const admin = latest?.updatedBy ? await this.prisma.user.findUnique({ where: { id: latest.updatedBy }, select: { name: true } }) : null;
    return { ...settings, lastChange: latest ? { at: latest.updatedAt, by: admin?.name ?? null } : null };
  }

  async update(dto: UpdateSettingsDto, adminId: string, ipAddress?: string): Promise<PlatformSettings> {
    const before = await this.get();

    const updates: [string, string | boolean | number | PaymentAccounts][] = [];
    if (dto.platformName !== undefined) updates.push(['platform_name', dto.platformName]);
    if (dto.supportEmail !== undefined) updates.push(['support_email', dto.supportEmail]);
    if (dto.defaultCurrency !== undefined) updates.push(['default_currency', dto.defaultCurrency]);
    if (dto.defaultTimezone !== undefined) updates.push(['default_timezone', dto.defaultTimezone]);
    if (dto.maintenanceMode !== undefined) updates.push(['maintenance_mode', dto.maintenanceMode]);
    if (dto.maintenanceMessage !== undefined) updates.push(['maintenance_message', dto.maintenanceMessage]);
    if (dto.maintenanceMessageBn !== undefined) updates.push(['maintenance_message_bn', dto.maintenanceMessageBn]);
    if (dto.signupsOpen !== undefined) updates.push(['signups_open', dto.signupsOpen]);
    if (dto.referralRewardAmount !== undefined) updates.push(['referral_reward_amount', dto.referralRewardAmount]);
    if (dto.billingManualInstructionsEn !== undefined) updates.push(['billing_manual_instructions_en', dto.billingManualInstructionsEn]);
    if (dto.billingManualInstructionsBn !== undefined) updates.push(['billing_manual_instructions_bn', dto.billingManualInstructionsBn]);
    if (dto.billingGraceDays !== undefined) updates.push(['billing_grace_days', dto.billingGraceDays]);
    if (dto.billingCheckoutHours !== undefined) updates.push(['billing_checkout_hours', dto.billingCheckoutHours]);
    if (dto.billingPaymentAccounts !== undefined) updates.push(['billing_payment_accounts', parsePaymentAccounts(dto.billingPaymentAccounts)]);
    if (dto.adminTwoStepRequired !== undefined) updates.push(['admin_two_step_required', dto.adminTwoStepRequired]);

    // Every field and its audit entry together: a failure half-way used to
    // leave some settings changed with no record of who changed them.
    await this.prisma.$transaction(async (tx) => {
      for (const [key, value] of updates) {
        await tx.platformSetting.upsert({
          where: { key },
          update: { value: value as unknown as Prisma.InputJsonValue, updatedBy: adminId },
          create: { key, value: value as unknown as Prisma.InputJsonValue, updatedBy: adminId },
        });
      }
      if (updates.length > 0) {
        const after = { ...before, ...Object.fromEntries(updates.map(([key, value]) => [KEY_TO_FIELD[key], value])) };
        await tx.auditLog.create({
          data: {
            adminUserId: adminId,
            action: 'PLATFORM_SETTINGS_UPDATED',
            entityType: 'PlatformSetting',
            oldValue: before as unknown as Prisma.InputJsonValue,
            newValue: after as unknown as Prisma.InputJsonValue,
            ipAddress,
          },
        });
      }
    });

    this.cached = null;
    return this.get();
  }
}
