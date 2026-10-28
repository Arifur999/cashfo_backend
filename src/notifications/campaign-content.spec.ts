import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { renderCampaignEmail } from '../mail/templates/campaign-email.js';
import { audienceWhere, campaignFilterOf, fillPlaceholders, recipientVariables, renderTemplate } from './campaign-content.js';
import { CreateCampaignDto } from './dto/create-campaign.dto.js';

const NOW = new Date('2026-10-28T06:00:00Z');
const DAY = 24 * 60 * 60 * 1000;

describe('campaignFilterOf', () => {
  it('keeps the known rules and drops anything else', () => {
    expect(campaignFilterOf({ planId: 'p1', status: 'ACTIVE', lastActiveWithinDays: 30, language: 'BN', role: 'SUPER_ADMIN' })).toEqual({
      planId: 'p1',
      status: 'ACTIVE',
      lastActiveWithinDays: 30,
      language: 'BN',
    });
    expect(campaignFilterOf({ lastActiveWithinDays: '30', language: 'FR', planId: '' })).toEqual({});
    expect(campaignFilterOf(null)).toEqual({});
  });
});

describe('audienceWhere', () => {
  it('is every customer for an empty filter, and only ACTIVE ones when sending', () => {
    expect(audienceWhere({}, NOW)).toEqual({ AND: [{ role: 'USER' }] });
    expect(audienceWhere({}, NOW, true)).toEqual({ AND: [{ role: 'USER' }, { status: 'ACTIVE' }] });
  });

  it('reads the plan from the subscription, else the default workspace', () => {
    expect(audienceWhere({ planId: 'free' }, NOW).AND).toContainEqual({
      OR: [{ subscription: { planId: 'free' } }, { subscription: null, ownedBusinesses: { some: { deletedAt: null, isDefault: true, planId: 'free' } } }],
    });
  });

  it('adds last active and language', () => {
    const where = audienceWhere({ lastActiveWithinDays: 30, language: 'BN' }, NOW);
    expect(where.AND).toContainEqual({ lastLoginAt: { gte: new Date(NOW.getTime() - 30 * DAY) } });
    expect(where.AND).toContainEqual({ preferredLanguage: 'BN' });
  });

  it("keeps the status rule's old meaning: BANNED has no customer counterpart", () => {
    expect(audienceWhere({ status: 'SUSPENDED' }, NOW).AND).toContainEqual({ status: 'SUSPENDED' });
    expect(audienceWhere({ status: 'BANNED' }, NOW).AND).toContainEqual({ status: 'DELETED' });
    // A send to SUSPENDED people reaches nobody: both rules apply.
    expect(audienceWhere({ status: 'SUSPENDED' }, NOW, true).AND).toEqual([{ role: 'USER' }, { status: 'ACTIVE' }, { status: 'SUSPENDED' }]);
  });
});

describe('template rendering', () => {
  const values = recipientVariables({ name: 'Sharmin  Akter', email: 'sharmin@example.com', planName: 'Monthly Pro' }, 'Smartly');

  it('fills the placeholders and leaves unknown ones as written', () => {
    expect(values.firstName).toBe('Sharmin');
    expect(fillPlaceholders('Hi {{ firstName }}, {{planName}} on {{expiryDate}} for {{email}} ({{appName}})', values)).toBe(
      'Hi Sharmin, Monthly Pro on {{expiryDate}} for sharmin@example.com (Smartly)',
    );
    expect(fillPlaceholders('{{toString}} {{constructor}}', values)).toBe('{{toString}} {{constructor}}');
  });

  it("picks the person's language, falling back to English for a blank Bangla field", () => {
    const template = { subjectEn: 'Offer for {{userName}}', subjectBn: 'অফার {{userName}}', bodyEn: 'Hello', bodyBn: 'হ্যালো' };
    expect(renderTemplate(template, 'BN', values)).toEqual({ subject: 'অফার Sharmin  Akter', body: 'হ্যালো' });
    expect(renderTemplate({ ...template, subjectBn: ' ', bodyBn: '' }, 'BN', values)).toEqual({ subject: 'Offer for Sharmin  Akter', body: 'Hello' });
    expect(renderTemplate({ ...template, subjectEn: null, subjectBn: null }, 'EN', values).subject).toBeNull();
  });

  it('escapes the message and the name inside it in the email', () => {
    const { html, text, subject } = renderCampaignEmail('en', { subject: 'Hi', body: 'Hi <b>{{x}}</b>\nline 2', link: 'https://app.example' }, 'Smartly');
    expect(subject).toBe('Hi');
    expect(html).toContain('Hi &lt;b&gt;{{x}}&lt;/b&gt;\nline 2');
    expect(html).not.toContain('<b>');
    expect(text).toContain('Open Smartly: https://app.example');
  });
});

describe('CreateCampaignDto', () => {
  const check = (targetFilter: object) =>
    validate(plainToInstance(CreateCampaignDto, { title: 'Puja offer', templateKey: 'promo_offer', channel: 'EMAIL', targetFilter }), {
      whitelist: true,
      forbidNonWhitelisted: true,
    });

  it('takes the new rules and refuses out-of-range ones', async () => {
    expect(await check({ planId: 'p1', lastActiveWithinDays: 30, language: 'EN' })).toHaveLength(0);
    const errors = await check({ lastActiveWithinDays: 0, language: 'FR' });
    expect(errors[0].children?.map((child) => child.property).sort()).toEqual(['language', 'lastActiveWithinDays']);
    expect(await check({ lastActiveWithinDays: 366 })).toHaveLength(1);
    expect(await check({ role: 'SUPER_ADMIN' })).toHaveLength(1);
  });
});
