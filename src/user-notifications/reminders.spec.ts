import { describe, expect, it } from 'vitest';
import { announcementReminders, budgetReminders, loanReminders, savingsReminders } from './reminders.js';

describe('budgetReminders', () => {
  it('reminds once past 90% of a limit and again once over it', () => {
    const drafts = budgetReminders('b1', '2026-10', [
      { id: 'shop', name: 'Shopping', monthlyLimit: '5000.00', spent: '4900.00' },
      { id: 'food', name: 'Food', monthlyLimit: '8000.00', spent: '8400.00' },
      { id: 'rent', name: 'Rent', monthlyLimit: '15000.00', spent: '12000.00' },
      { id: 'misc', name: 'Misc', monthlyLimit: null, spent: '700.00' },
    ]);
    expect(drafts.map((d) => d.key)).toEqual(['budget:shop:2026-10:90', 'budget:food:2026-10:over']);
    expect(drafts[0].data).toEqual({ category: 'Shopping', percent: 98, left: '100.00', month: '2026-10' });
    expect(drafts[1].data.left).toBe('-400.00');
  });
});

describe('loanReminders', () => {
  it('keys each reminder by the entry and its due date', () => {
    const [draft] = loanReminders('b1', [
      { transactionId: 't1', contactId: 'c1', contactName: 'Islami Bank', contactCategory: 'LOAN', direction: 'PAYABLE', remainingAmount: '5000.00', dueDate: new Date('2026-10-05T00:00:00.000Z'), daysUntilDue: 3 },
    ]);
    expect(draft.key).toBe('loan:t1:2026-10-05');
    expect(draft.data).toEqual({ name: 'Islami Bank', contactId: 'c1', loan: 1, direction: 'PAYABLE', amount: '5000.00', dueDate: '2026-10-05', days: 3 });
  });
});

describe('savingsReminders', () => {
  const today = new Date('2026-10-02T00:00:00.000Z');
  const goal = { id: 'g1', name: 'iPhone', targetAmount: '150000.00', currentAmount: '48750.00', targetDate: new Date('2027-01-31T00:00:00.000Z'), progressPercent: 33, paceStatus: 'BEHIND' as const };

  it('spreads what is left over the months to the target date', () => {
    const [draft] = savingsReminders('b1', '2026-10', today, [goal]);
    expect(draft.key).toBe('savings:g1:2026-10');
    expect(draft.data).toMatchObject({ goal: 'iPhone', behind: 1, perMonth: '33750.00', targetDate: '2027-01-31' });
  });

  it('skips goals that are reached or not active', () => {
    expect(savingsReminders('b1', '2026-10', today, [{ ...goal, currentAmount: '150000.00' }, { ...goal, id: 'g2', paceStatus: null }])).toEqual([]);
  });

  it('asks for the whole rest within the last month', () => {
    const [draft] = savingsReminders('b1', '2026-10', today, [{ ...goal, targetDate: new Date('2026-10-20T00:00:00.000Z'), paceStatus: 'ON_TRACK' }]);
    expect(draft.data).toMatchObject({ behind: 0, perMonth: '101250.00' });
  });
});

describe('announcementReminders', () => {
  it('carries both languages and the start as its time', () => {
    const startAt = new Date('2026-09-29T04:00:00.000Z');
    const [draft] = announcementReminders([{ id: 'a1', title: 'New', titleBn: 'নতুন', body: 'Body', bodyBn: null, startAt }]);
    expect(draft).toEqual({ key: 'announcement:a1', type: 'ANNOUNCEMENT', businessId: null, data: { title: 'New', titleBn: 'নতুন', body: 'Body', bodyBn: null }, at: startAt });
  });
});
