import { Prisma } from '@prisma/client';
import { END_USER_WHERE } from '../common/roles.js';

const DAY_MS = 24 * 60 * 60 * 1000;

// A campaign's "Who gets it", as stored in BulkNotificationCampaign.targetFilter
// (CreateCampaignDto's TargetFilterDto). Every rule is optional; together they
// narrow the audience.
export interface CampaignFilter {
  planId?: string;
  // A legacy PlatformUserStatus value; see statusOf().
  status?: string;
  // Signed in within this many days.
  lastActiveWithinDays?: number;
  language?: 'EN' | 'BN';
}

// The filter as saved: anything else in the JSON is ignored, so an old row
// with a stray key can't widen or break a send.
export function campaignFilterOf(raw: unknown): CampaignFilter {
  const value = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
  const days = typeof value.lastActiveWithinDays === 'number' && Number.isInteger(value.lastActiveWithinDays) ? value.lastActiveWithinDays : undefined;
  return {
    ...(typeof value.planId === 'string' && value.planId && { planId: value.planId }),
    ...(typeof value.status === 'string' && value.status && { status: value.status }),
    ...(days !== undefined && days >= 1 && { lastActiveWithinDays: days }),
    ...((value.language === 'EN' || value.language === 'BN') && { language: value.language }),
  };
}

// The status rule names the legacy PlatformUserStatus values. The ones a
// customer account also has match those; BANNED has no counterpart and
// matches only deleted accounts, as the count always did.
const statusOf = (status: string | undefined) =>
  status === 'ACTIVE' || status === 'SUSPENDED' || status === 'PENDING_DELETION' ? status : status ? ('DELETED' as const) : undefined;

// Who a filter matches. `sending` keeps only ACTIVE customers: a suspended,
// deleted or about-to-be-deleted account never gets a campaign, whatever the
// status rule says. A person's plan is their own subscription's, or, without
// one, their default workspace's (where plans lived before subscriptions).
export function audienceWhere(filter: CampaignFilter, now: Date, sending = false): Prisma.UserWhereInput {
  const status = statusOf(filter.status);
  const and: Prisma.UserWhereInput[] = [END_USER_WHERE];
  if (sending) and.push({ status: 'ACTIVE' });
  if (status) and.push({ status });
  if (filter.planId) {
    and.push({
      OR: [
        { subscription: { planId: filter.planId } },
        { subscription: null, ownedBusinesses: { some: { deletedAt: null, isDefault: true, planId: filter.planId } } },
      ],
    });
  }
  if (filter.lastActiveWithinDays) and.push({ lastLoginAt: { gte: new Date(now.getTime() - filter.lastActiveWithinDays * DAY_MS) } });
  if (filter.language) and.push({ preferredLanguage: filter.language });
  return { AND: and };
}

// What a template's {{placeholders}} are filled with for one person.
export interface Recipient {
  name: string;
  email: string;
  planName: string | null;
}

export const recipientVariables = (person: Recipient, appName: string): Record<string, string> => ({
  userName: person.name,
  firstName: person.name.trim().split(/\s+/)[0] || person.name,
  planName: person.planName ?? '',
  email: person.email,
  appName,
});

// Fills {{name}} (spaces inside the braces allowed) from `values`. A
// placeholder with no value is left as written, so a typo shows up in the
// test send instead of silently vanishing.
export const fillPlaceholders = (text: string, values: Record<string, string>): string =>
  text.replace(/\{\{\s*([A-Za-z0-9_]+)\s*\}\}/g, (whole, name: string) => (Object.hasOwn(values, name) ? values[name] : whole));

export interface TemplateText {
  subjectEn: string | null;
  subjectBn: string | null;
  bodyEn: string;
  bodyBn: string;
}

// The template in one language, filled in. A blank Bangla field falls back
// to the English one; subject is null when the template has none.
export function renderTemplate(template: TemplateText, language: 'EN' | 'BN', values: Record<string, string>): { subject: string | null; body: string } {
  const bn = language === 'BN';
  const subject = (bn && template.subjectBn?.trim() ? template.subjectBn : template.subjectEn)?.trim() || null;
  const body = bn && template.bodyBn.trim() ? template.bodyBn : template.bodyEn;
  return { subject: subject && fillPlaceholders(subject, values), body: fillPlaceholders(body, values) };
}

// A send that stopped part-way (the server restarted) is picked up again
// once it has made no progress for this long.
export const STALE_SEND_MS = 15 * 60 * 1000;
