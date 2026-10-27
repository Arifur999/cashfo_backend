import { payerIdOf, requesterNames } from '../admin-feed/requester-names.js';
import type { PrismaService } from '../prisma/prisma.service.js';

type Labeler = (prisma: PrismaService, ids: string[]) => Promise<Array<{ id: string; label: string }>>;

const named = (rows: Array<{ id: string; name: string }>) => rows.map((row) => ({ id: row.id, label: row.name }));
const where = (ids: string[]) => ({ id: { in: ids } });

// What a person calls each kind of record, so the audit log can say
// "Yearly Pro" instead of "SubscriptionPlan #b7e2c4a1". A payment answers
// with its payer and a ticket with its subject (the panel puts the short id
// in front); a legal page answers with its type (PRIVACY_POLICY), which the
// panel words. Platform settings have no single record, so no label.
const LABELERS: Record<string, Labeler> = {
  AdminUser: async (prisma, ids) => named(await prisma.user.findMany({ where: where(ids), select: { id: true, name: true } })),
  User: async (prisma, ids) => named(await prisma.user.findMany({ where: where(ids), select: { id: true, name: true } })),
  // An admin invite answers with the address it went to.
  AdminInvite: async (prisma, ids) =>
    (await prisma.adminInvite.findMany({ where: where(ids), select: { id: true, email: true } })).map((row) => ({ id: row.id, label: row.email })),
  PlatformUser: async (prisma, ids) => named(await prisma.platformUser.findMany({ where: where(ids), select: { id: true, name: true } })),
  Business: async (prisma, ids) => named(await prisma.business.findMany({ where: where(ids), select: { id: true, name: true } })),
  SubscriptionPlan: async (prisma, ids) => named(await prisma.subscriptionPlan.findMany({ where: where(ids), select: { id: true, name: true } })),
  DefaultAccountTemplate: async (prisma, ids) =>
    named(await prisma.defaultAccountTemplate.findMany({ where: where(ids), select: { id: true, name: true } })),
  BulkNotificationCampaign: async (prisma, ids) =>
    (await prisma.bulkNotificationCampaign.findMany({ where: where(ids), select: { id: true, title: true } })).map((row) => ({ id: row.id, label: row.title })),
  Coupon: async (prisma, ids) => (await prisma.coupon.findMany({ where: where(ids), select: { id: true, code: true } })).map((row) => ({ id: row.id, label: row.code })),
  FeatureFlag: async (prisma, ids) => (await prisma.featureFlag.findMany({ where: where(ids), select: { id: true, key: true } })).map((row) => ({ id: row.id, label: row.key })),
  NotificationTemplate: async (prisma, ids) =>
    (await prisma.notificationTemplate.findMany({ where: where(ids), select: { id: true, key: true } })).map((row) => ({ id: row.id, label: row.key })),
  TranslationString: async (prisma, ids) =>
    (await prisma.translationString.findMany({ where: where(ids), select: { id: true, key: true } })).map((row) => ({ id: row.id, label: row.key })),
  LegalDocument: async (prisma, ids) =>
    (await prisma.legalDocument.findMany({ where: where(ids), select: { id: true, type: true } })).map((row) => ({ id: row.id, label: row.type })),
  SupportTicket: async (prisma, ids) =>
    (await prisma.supportTicket.findMany({ where: where(ids), select: { id: true, subject: true } })).map((row) => ({ id: row.id, label: row.subject })),
  SuspiciousActivityFlag: async (prisma, ids) =>
    (await prisma.suspiciousActivityFlag.findMany({ where: where(ids), select: { id: true, description: true } })).map((row) => ({
      id: row.id,
      label: row.description,
    })),
  // A referral withdrawal answers with its number and member; a referral
  // with "referrer → friend".
  PayoutRequest: async (prisma, ids) =>
    (await prisma.payoutRequest.findMany({ where: where(ids), select: { id: true, number: true, user: { select: { name: true } } } })).map((row) => ({
      id: row.id,
      label: `WD-${row.number} ${row.user.name}`,
    })),
  Referral: async (prisma, ids) =>
    (await prisma.referral.findMany({ where: where(ids), select: { id: true, referrer: { select: { name: true } }, referredUser: { select: { name: true } } } })).map(
      (row) => ({ id: row.id, label: `${row.referrer.name} → ${row.referredUser.name}` }),
    ),
  // A payment answers with its payer: the customer (userId), or for an old
  // sandbox payment its PlatformUser -- both loose, so a second read.
  Payment: async (prisma, ids) => {
    const payments = await prisma.payment.findMany({ where: where(ids), select: { id: true, userId: true, platformUserId: true } });
    const nameById = await requesterNames(prisma, payments.map(payerIdOf));
    return payments.flatMap((payment) => {
      const payer = payerIdOf(payment);
      const name = payer ? nameById.get(payer) : undefined;
      return name ? [{ id: payment.id, label: name }] : [];
    });
  },
};

export interface AuditRecordRef {
  entityType: string;
  entityId: string | null;
}

// Adds `entityLabel` to each entry with one read per record type on the
// page. It stays null when the record is gone (a deleted coupon), has no
// single id, or is of a type nobody names.
export async function withEntityLabels<T extends AuditRecordRef>(prisma: PrismaService, entries: T[]): Promise<Array<T & { entityLabel: string | null }>> {
  const idsByType = new Map<string, Set<string>>();
  for (const entry of entries) {
    if (!entry.entityId || !LABELERS[entry.entityType]) continue;
    const ids = idsByType.get(entry.entityType) ?? new Set<string>();
    ids.add(entry.entityId);
    idsByType.set(entry.entityType, ids);
  }

  const labels = new Map<string, string>();
  await Promise.all(
    [...idsByType].map(async ([type, ids]) => {
      for (const { id, label } of await LABELERS[type](prisma, [...ids])) {
        labels.set(`${type}:${id}`, label);
      }
    }),
  );

  return entries.map((entry) => ({
    ...entry,
    entityLabel: entry.entityId ? (labels.get(`${entry.entityType}:${entry.entityId}`) ?? null) : null,
  }));
}
